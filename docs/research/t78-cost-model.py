"""Cloud DB cost model for Project Tracker (ticket #78). Emits t78-cost-model-report.html."""
import html
import math

KB = 1024
GB = 1024 ** 3

# Measured from the live local DB (2026-11-28): 289 tickets in 1.71 MB of pages.
TICKET_BYTES = 5_900
LANE_BYTES = 900
WORKFLOW_BYTES = 2_000  # workflows table is empty locally; estimated from lanes_json shape
INDEX_OVERHEAD = 1.5
GZIP_RATIO = 0.3

ACTIVE_DAYS = 22
ACTIVE_HOURS_PER_DAY = 8
POLL_SECONDS = 60
POLLS_PER_MONTH = ACTIVE_DAYS * ACTIVE_HOURS_PER_DAY * 3600 // POLL_SECONDS
FULL_LOADS_PER_MONTH = ACTIVE_DAYS * 2

PROFILES = {
    "Light":  {"tickets": 100,    "lanes": 8,   "workflows": 1,  "edits_per_day": 10},
    "Medium": {"tickets": 1_000,  "lanes": 20,  "workflows": 5,  "edits_per_day": 30},
    "Heavy":  {"tickets": 10_000, "lanes": 100, "workflows": 25, "edits_per_day": 100},
}
USER_COUNTS = [1, 10, 100, 1_000, 10_000, 100_000, 1_000_000]


def workload(profile, users):
    rows = profile["tickets"] + profile["lanes"] + profile["workflows"]
    raw_bytes = (profile["tickets"] * TICKET_BYTES
                 + profile["lanes"] * LANE_BYTES
                 + profile["workflows"] * WORKFLOW_BYTES)
    writes_per_user = profile["edits_per_day"] * ACTIVE_DAYS
    full_load_rows = FULL_LOADS_PER_MONTH * rows
    return {
        "users": users,
        "rows": rows,
        "avg_row_bytes": raw_bytes / rows,
        "storage_gb": users * raw_bytes * INDEX_OVERHEAD / GB,
        "polls": users * POLLS_PER_MONTH,
        "full_load_rows": users * full_load_rows,
        "full_load_bytes": users * FULL_LOADS_PER_MONTH * raw_bytes,
        "writes": users * writes_per_user,
        "requests": users * (POLLS_PER_MONTH + FULL_LOADS_PER_MONTH + writes_per_user),
        "egress_gb": users * FULL_LOADS_PER_MONTH * raw_bytes * GZIP_RATIO / GB,
    }


def tiered_egress(gb, free_gb, rate):
    return max(0.0, gb - free_gb) * rate


# ---- API layer in front of each DB (desktop clients can't hold multi-tenant DB creds) ----
def aws_api(w):  # API Gateway HTTP API $1.00/M + Lambda $0.20/M + ~50ms@256MB
    lambda_gb_seconds = w["requests"] * 0.05 * 0.25
    return w["requests"] / 1e6 * 1.20 + lambda_gb_seconds * 0.0000166667


def azure_api(w):  # Functions consumption: 1M exec + 400k GB-s free, $0.20/M, $0.000016/GB-s
    gb_seconds = w["requests"] * 0.05 * 0.25
    return max(0, w["requests"] - 1e6) / 1e6 * 0.20 + max(0, gb_seconds - 400_000) * 0.000016


def gcp_api(w):  # Cloud Run: 2M req free, $0.40/M + cpu/mem ~ $0.000024/vCPU-s
    vcpu_seconds = w["requests"] * 0.05 / 80  # concurrency 80
    return max(0, w["requests"] - 2e6) / 1e6 * 0.40 + vcpu_seconds * 0.000024


def cf_api(w):  # Workers Paid: $5 base, 10M req incl then $0.30/M, 30M CPU-ms incl then $0.02/M
    cpu_ms = w["requests"] * 5
    return (5.0 + max(0, w["requests"] - 10e6) / 1e6 * 0.30
            + max(0, cpu_ms - 30e6) / 1e6 * 0.02)


# ---- Serverless databases ----
def dynamodb(w):
    item_kb = w["avg_row_bytes"] / KB
    read_units = (w["polls"] * 0.5
                  + w["full_load_bytes"] / (4 * KB) * 0.5)  # eventually consistent Query
    write_units = w["writes"] * math.ceil(item_kb) * 2      # whole item rewrite + 1 GSI
    db = read_units / 1e6 * 0.125 + write_units / 1e6 * 0.625 + max(0, w["storage_gb"] - 25) * 0.25
    return db + aws_api(w) + tiered_egress(w["egress_gb"], 100, 0.09)


def cosmos(w):
    request_units = (w["polls"] * 1
                     + w["full_load_rows"] * 0.6  # query RU per returned ~6 KB doc
                     + w["writes"] * 12)
    db = request_units / 1e6 * 0.25 + w["storage_gb"] * 0.25
    return db + azure_api(w) + tiered_egress(w["egress_gb"], 100, 0.087)


def firestore(w):
    daily_free_reads = 50_000 * 30
    daily_free_writes = 20_000 * 30
    reads = w["polls"] + w["full_load_rows"]
    db = (max(0, reads - daily_free_reads) / 1e5 * 0.03
          + max(0, w["writes"] - daily_free_writes) / 1e5 * 0.09
          + max(0, w["storage_gb"] - 1) * 0.18)
    return db + gcp_api(w) + tiered_egress(w["egress_gb"], 1, 0.12)


def d1(w):
    rows_read = w["polls"] + w["full_load_rows"]
    rows_written = w["writes"] * 3  # row + 2 index entries
    db = (max(0, rows_read - 25e9) / 1e6 * 0.001
          + max(0, rows_written - 50e6) / 1e6 * 1.00
          + max(0, w["storage_gb"] - 5) * 0.75)
    return db + cf_api(w)  # no egress fees


# ---- Managed Postgres (instance-priced; step function by user count) ----
# Monthly on-demand, us-east / equivalent region, approximate list price.
INSTANCE_STEPS = [  # (max users, aws, azure, gcp, label)
    (100,       12,    13,    10,   "1 vCPU burst / ~1 GB"),
    (1_000,     48,    55,    52,   "2 vCPU / 4 GB"),
    (10_000,    330,   360,   350,  "2 vCPU / 16 GB, HA pair"),
    (100_000,   1_310, 1_420, 1_400, "8 vCPU / 64 GB, HA pair"),
    (1_000_000, 7_900, 8_600, 8_300, "32 vCPU / 256 GB, HA + 2 read replicas"),
]
SQL_STORAGE_RATE = {"aws": 0.115 * 2, "azure": 0.115 * 2, "gcp": 0.17 * 2}  # x2 for HA copy


def postgres(provider):
    column = {"aws": 1, "azure": 2, "gcp": 3}[provider]
    api = {"aws": aws_api, "azure": azure_api, "gcp": gcp_api}[provider]
    egress = {"aws": (100, 0.09), "azure": (100, 0.087), "gcp": (1, 0.12)}[provider]

    def cost(w):
        step = next(s for s in INSTANCE_STEPS if w["users"] <= s[0])
        instance = step[column]
        return (instance + w["storage_gb"] * SQL_STORAGE_RATE[provider]
                + api(w) + tiered_egress(w["egress_gb"], *egress))
    return cost


# ---- Object storage: one SQLite file per user, sync whole file (single-writer only) ----
def r2(w):
    uploads = w["writes"] / 5  # debounce: one upload per 5 edits
    db = (max(0, w["storage_gb"] - 10) * 0.015
          + max(0, uploads - 1e6) / 1e6 * 4.50
          + max(0, w["polls"] - 10e6) / 1e6 * 0.36)  # HEAD/GET ETag check per poll
    return db + cf_api(w)


def s3(w):
    uploads = w["writes"] / 5
    db = w["storage_gb"] * 0.023 + uploads / 1000 * 0.005 + w["polls"] / 1000 * 0.0004
    full_file_egress = w["egress_gb"]  # file download on change ~ same as full loads
    return db + aws_api(w) + tiered_egress(full_file_egress, 100, 0.09)


OPTIONS = [
    ("AWS", "DynamoDB on-demand", dynamodb),
    ("AWS", "RDS Postgres", postgres("aws")),
    ("AWS", "S3 SQLite file", s3),
    ("Azure", "Cosmos DB serverless", cosmos),
    ("Azure", "Postgres Flexible", postgres("azure")),
    ("GCP", "Firestore", firestore),
    ("GCP", "Cloud SQL Postgres", postgres("gcp")),
    ("Cloudflare", "D1 + Workers", d1),
    ("Cloudflare", "R2 SQLite file", r2),
]


FILE_SYNC = {"S3 SQLite file", "R2 SQLite file"}


def cheapest_database(costs):
    return min(c for c, (_, name, _) in zip(costs, OPTIONS) if name not in FILE_SYNC)


def cell_class(cost, cheapest, name):
    if name in FILE_SYNC:
        return "file"
    return "best" if cost == cheapest else ""


def money(value):
    if value < 1:
        return f"${value:,.3f}"
    if value < 10:
        return f"${value:,.2f}"
    return f"${value:,.0f}"


def user_table(profile_name):
    profile = PROFILES[profile_name]
    head = "".join(f"<th>{html.escape(p)}<br><small>{html.escape(n)}</small></th>" for p, n, _ in OPTIONS)
    body = []
    for users in USER_COUNTS:
        w = workload(profile, users)
        costs = [fn(w) for _, _, fn in OPTIONS]
        cheapest = cheapest_database(costs)
        cells = "".join(
            f"<td class='{cell_class(c, cheapest, name)}'>{money(c)}<br><small>{money(c / users)}/u</small></td>"
            for c, (_, name, _) in zip(costs, OPTIONS))
        body.append(f"<tr><th>{users:,}</th>{cells}</tr>")
    return f"<table><tr><th>Users</th>{head}</tr>{''.join(body)}</table>"


def scaling_table(dimension, values, users=1_000):
    base = dict(PROFILES["Medium"])
    head = "".join(f"<th>{html.escape(p)}<br><small>{html.escape(n)}</small></th>" for p, n, _ in OPTIONS)
    body = []
    for value in values:
        profile = dict(base, **{dimension: value})
        w = workload(profile, users)
        costs = [fn(w) / users for _, _, fn in OPTIONS]
        cheapest = cheapest_database(costs)
        cells = "".join(f"<td class='{cell_class(c, cheapest, name)}'>{money(c)}</td>"
                        for c, (_, name, _) in zip(costs, OPTIONS))
        size_mb = w["storage_gb"] / users * 1024
        body.append(f"<tr><th>{value:,}<br><small>{size_mb:,.1f} MB/u</small></th>{cells}</tr>")
    return f"<table><tr><th>{dimension.title()} / user</th>{head}</tr>{''.join(body)}</table>"


def demo():
    w = workload(PROFILES["Medium"], 1)
    assert POLLS_PER_MONTH == 10_560
    assert w["rows"] == 1_025
    assert d1(workload(PROFILES["Light"], 1)) == 5.0  # inside Workers Paid allowances
    many = workload(PROFILES["Medium"], 1_000_000)
    assert d1(many) < dynamodb(many), "D1 should beat DynamoDB at 1M users (no egress)"
    assert all(fn(many) > fn(workload(PROFILES["Medium"], 1)) for _, _, fn in OPTIONS)


if __name__ == "__main__":
    demo()
    template = open(__file__.replace(".py", "-template.html")).read()
    sections = {
        "{{LIGHT}}": user_table("Light"),
        "{{MEDIUM}}": user_table("Medium"),
        "{{HEAVY}}": user_table("Heavy"),
        "{{TICKETS}}": scaling_table("tickets", [100, 1_000, 5_000, 10_000, 50_000, 100_000]),
        "{{WORKFLOWS}}": scaling_table("workflows", [1, 5, 10, 50, 100, 500]),
        "{{LANES}}": scaling_table("lanes", [5, 20, 50, 100, 500, 1_000]),
        "{{POLLS}}": f"{POLLS_PER_MONTH:,}",
    }
    for key, value in sections.items():
        template = template.replace(key, value)
    open(__file__.replace(".py", "-report.html"), "w").write(template)
    print("ok")
