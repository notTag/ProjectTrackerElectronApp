import html
import math
import os

KB = 1024
GB = 1024 ** 3

TICKET_BYTES = 5_900
LANE_BYTES = 900
WORKFLOW_BYTES = 2_000
INDEX_OVERHEAD = 1.5
GZIP_RATIO = 0.3

ACTIVE_DAYS = 22
ACTIVE_HOURS_PER_DAY = 8
ACTIVE_SECONDS_PER_MONTH = ACTIVE_DAYS * ACTIVE_HOURS_PER_DAY * 3600
POLL_SECONDS = 60
POLLS_PER_MONTH = ACTIVE_SECONDS_PER_MONTH // POLL_SECONDS
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


FUNCTION_SECONDS_PER_REQUEST = 0.05
FUNCTION_MEMORY_GB = 0.25
CLOUD_RUN_CONCURRENCY = 80
WORKER_CPU_MS_PER_REQUEST = 5


def aws_api(usage):
    lambda_gb_seconds = usage["requests"] * FUNCTION_SECONDS_PER_REQUEST * FUNCTION_MEMORY_GB
    return usage["requests"] / 1e6 * 1.20 + lambda_gb_seconds * 0.0000166667


def azure_api(usage):
    gb_seconds = usage["requests"] * FUNCTION_SECONDS_PER_REQUEST * FUNCTION_MEMORY_GB
    return max(0, usage["requests"] - 1e6) / 1e6 * 0.20 + max(0, gb_seconds - 400_000) * 0.000016


def gcp_api(usage):
    vcpu_seconds = usage["requests"] * FUNCTION_SECONDS_PER_REQUEST / CLOUD_RUN_CONCURRENCY
    return max(0, usage["requests"] - 2e6) / 1e6 * 0.40 + vcpu_seconds * 0.000024


def cf_api(usage):
    cpu_ms = usage["requests"] * WORKER_CPU_MS_PER_REQUEST
    return (WORKERS_PAID_BASE + max(0, usage["requests"] - 10e6) / 1e6 * 0.30
            + max(0, cpu_ms - 30e6) / 1e6 * 0.02)


def dynamodb(usage):
    item_kb = usage["avg_row_bytes"] / KB
    eventually_consistent_read_cost = 0.5
    writes_per_item_with_one_index = 2
    read_units = (usage["polls"] * eventually_consistent_read_cost
                  + usage["full_load_bytes"] / (4 * KB) * eventually_consistent_read_cost)
    write_units = usage["writes"] * math.ceil(item_kb) * writes_per_item_with_one_index
    db = read_units / 1e6 * 0.125 + write_units / 1e6 * 0.625 + max(0, usage["storage_gb"] - 25) * 0.25
    return db + aws_api(usage) + tiered_egress(usage["egress_gb"], 100, 0.09)


COSMOS_SERVERLESS_MAX_RU_PER_SECOND = 5_000
COSMOS_SERVERLESS_MAX_CONTAINER_GB = 1024


def cosmos_request_units(usage):
    query_units_per_returned_doc = 0.6
    return (usage["polls"] * 1
            + usage["full_load_rows"] * query_units_per_returned_doc
            + usage["writes"] * 12)


def cosmos_over_serverless_limits(usage):
    average_active_ru_per_second = cosmos_request_units(usage) / ACTIVE_SECONDS_PER_MONTH
    too_busy = average_active_ru_per_second > COSMOS_SERVERLESS_MAX_RU_PER_SECOND
    too_big = usage["storage_gb"] > COSMOS_SERVERLESS_MAX_CONTAINER_GB
    return too_busy or too_big


def cosmos(usage):
    db = cosmos_request_units(usage) / 1e6 * 0.25 + usage["storage_gb"] * 0.25
    return db + azure_api(usage) + tiered_egress(usage["egress_gb"], 100, 0.087)


def firestore(usage):
    monthly_free_reads = 50_000 * 30
    monthly_free_writes = 20_000 * 30
    reads = usage["polls"] + usage["full_load_rows"]
    db = (max(0, reads - monthly_free_reads) / 1e5 * 0.03
          + max(0, usage["writes"] - monthly_free_writes) / 1e5 * 0.09
          + max(0, usage["storage_gb"] - 1) * 0.18)
    return db + gcp_api(usage) + tiered_egress(usage["egress_gb"], 1, 0.12)


D1_ACCOUNT_STORAGE_CAP_GB = 1024
WORKERS_PAID_BASE = 5.0


def d1_accounts(usage):
    return max(1, math.ceil(usage["storage_gb"] / D1_ACCOUNT_STORAGE_CAP_GB))


def d1(usage):
    rows_read = usage["polls"] + usage["full_load_rows"]
    rows_written_per_edit_with_two_indexes = 3
    rows_written = usage["writes"] * rows_written_per_edit_with_two_indexes
    db = (max(0, rows_read - 25e9) / 1e6 * 0.001
          + max(0, rows_written - 50e6) / 1e6 * 1.00
          + max(0, usage["storage_gb"] - 5) * 0.75)
    extra_accounts = d1_accounts(usage) - 1
    return db + cf_api(usage) + extra_accounts * WORKERS_PAID_BASE


POSTGRES_MONTHLY_INSTANCE_BY_MAX_USERS = [
    {"max_users": 100,       "aws": 12,    "azure": 13,    "gcp": 10,    "size": "1 vCPU burst / ~1 GB"},
    {"max_users": 1_000,     "aws": 48,    "azure": 55,    "gcp": 52,    "size": "2 vCPU / 4 GB"},
    {"max_users": 10_000,    "aws": 330,   "azure": 360,   "gcp": 350,   "size": "2 vCPU / 16 GB, HA pair"},
    {"max_users": 100_000,   "aws": 1_310, "azure": 1_420, "gcp": 1_400, "size": "8 vCPU / 64 GB, HA pair"},
    {"max_users": 1_000_000, "aws": 7_900, "azure": 8_600, "gcp": 8_300, "size": "32 vCPU / 256 GB, HA + 2 read replicas"},
]
HA_STORAGE_COPIES = 2
SQL_STORAGE_RATE = {"aws": 0.115 * HA_STORAGE_COPIES, "azure": 0.115 * HA_STORAGE_COPIES, "gcp": 0.17 * HA_STORAGE_COPIES}


def postgres(provider):
    api = {"aws": aws_api, "azure": azure_api, "gcp": gcp_api}[provider]
    egress = {"aws": (100, 0.09), "azure": (100, 0.087), "gcp": (1, 0.12)}[provider]

    def cost(usage):
        step = next(s for s in POSTGRES_MONTHLY_INSTANCE_BY_MAX_USERS if usage["users"] <= s["max_users"])
        instance = step[provider]
        return (instance + usage["storage_gb"] * SQL_STORAGE_RATE[provider]
                + api(usage) + tiered_egress(usage["egress_gb"], *egress))
    return cost


EDITS_PER_FILE_UPLOAD = 5


def r2(usage):
    uploads = usage["writes"] / EDITS_PER_FILE_UPLOAD
    db = (max(0, usage["storage_gb"] - 10) * 0.015
          + max(0, uploads - 1e6) / 1e6 * 4.50
          + max(0, usage["polls"] - 10e6) / 1e6 * 0.36)
    return db + cf_api(usage)


def s3(usage):
    uploads = usage["writes"] / EDITS_PER_FILE_UPLOAD
    db = usage["storage_gb"] * 0.023 + uploads / 1000 * 0.005 + usage["polls"] / 1000 * 0.0004
    full_file_egress = usage["egress_gb"]
    return db + aws_api(usage) + tiered_egress(full_file_egress, 100, 0.09)


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
OVER_LIMIT_CHECKS = {"Cosmos DB serverless": cosmos_over_serverless_limits}


def cheapest_database(costs):
    return min(c for c, (_, name, _) in zip(costs, OPTIONS) if name not in FILE_SYNC)


def cell_class(cost, cheapest, name):
    if name in FILE_SYNC:
        return "file"
    return "best" if cost == cheapest else ""


def limit_marker(name, usage):
    check = OVER_LIMIT_CHECKS.get(name)
    return " †" if check and check(usage) else ""


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
        usage = workload(profile, users)
        costs = [fn(usage) for _, _, fn in OPTIONS]
        cheapest = cheapest_database(costs)
        cells = "".join(
            f"<td class='{cell_class(c, cheapest, name)}'>{money(c)}{limit_marker(name, usage)}"
            f"<br><small>{money(c / users)}/u</small></td>"
            for c, (_, name, _) in zip(costs, OPTIONS))
        body.append(f"<tr><th>{users:,}</th>{cells}</tr>")
    return f"<table><tr><th>Users</th>{head}</tr>{''.join(body)}</table>"


def scaling_table(dimension, values, users=1_000):
    base = dict(PROFILES["Medium"])
    head = "".join(f"<th>{html.escape(p)}<br><small>{html.escape(n)}</small></th>" for p, n, _ in OPTIONS)
    body = []
    for value in values:
        profile = dict(base, **{dimension: value})
        usage = workload(profile, users)
        costs = [fn(usage) / users for _, _, fn in OPTIONS]
        cheapest = cheapest_database(costs)
        cells = "".join(f"<td class='{cell_class(c, cheapest, name)}'>{money(c)}{limit_marker(name, usage)}</td>"
                        for c, (_, name, _) in zip(costs, OPTIONS))
        size_mb = usage["storage_gb"] / users * 1024
        body.append(f"<tr><th>{value:,}<br><small>{size_mb:,.1f} MB/u</small></th>{cells}</tr>")
    return f"<table><tr><th>{dimension.title()} / user</th>{head}</tr>{''.join(body)}</table>"


def demo():
    usage = workload(PROFILES["Medium"], 1)
    assert POLLS_PER_MONTH == 10_560
    assert usage["rows"] == 1_025
    assert d1(workload(PROFILES["Light"], 1)) == 5.0
    many = workload(PROFILES["Medium"], 1_000_000)
    assert d1(many) < dynamodb(many), "D1 should beat DynamoDB at 1M users (no egress)"
    assert d1_accounts(many) == 9
    assert cosmos_over_serverless_limits(many)
    assert not cosmos_over_serverless_limits(workload(PROFILES["Medium"], 10_000))
    assert all(fn(many) > fn(workload(PROFILES["Medium"], 1)) for _, _, fn in OPTIONS)


if __name__ == "__main__":
    demo()
    model_path_stem = os.path.splitext(__file__)[0]
    template = open(model_path_stem + "-template.html").read()
    heavy_at_million = workload(PROFILES["Heavy"], 1_000_000)
    medium_at_million = workload(PROFILES["Medium"], 1_000_000)
    sections = {
        "{{LIGHT}}": user_table("Light"),
        "{{MEDIUM}}": user_table("Medium"),
        "{{HEAVY}}": user_table("Heavy"),
        "{{TICKETS}}": scaling_table("tickets", [100, 1_000, 5_000, 10_000, 50_000, 100_000]),
        "{{WORKFLOWS}}": scaling_table("workflows", [1, 5, 10, 50, 100, 500]),
        "{{LANES}}": scaling_table("lanes", [5, 20, 50, 100, 500, 1_000]),
        "{{POLLS}}": f"{POLLS_PER_MONTH:,}",
        "{{HEAVY_1M_TIB}}": f"{heavy_at_million['storage_gb'] / 1024:,.0f}",
        "{{MEDIUM_1M_D1_ACCOUNTS}}": f"{d1_accounts(medium_at_million)}",
    }
    for key, value in sections.items():
        template = template.replace(key, value)
    open(model_path_stem + "-report.html", "w").write(template)
    print("ok")
