import { reactive, ref } from 'vue'

// Live look-tuning knobs for the board. Each control owns one `--ui-*` CSS var on
// :root; styles.css falls back to today's literals, so an unset var changes nothing.
// localStorage only: these are per-machine look tweaks, deliberately kept out of the DB.

type RangeControl = {
  kind: 'range'
  key: string
  label: string
  cssVar: string
  min: number
  max: number
  defaultValue: number
  unit: 'px' | ''
}

type ChoiceControl = {
  kind: 'choice'
  key: string
  label: string
  cssVar: string
  options: { value: string; label: string }[]
  defaultValue: string
}

export type UiDemoControl = RangeControl | ChoiceControl
export type UiDemoValues = Record<string, number | string>

const radius = (surface: string, label: string, defaultValue: number): RangeControl => ({
  kind: 'range',
  key: `${surface}Radius`,
  label,
  cssVar: `--ui-radius-${surface}`,
  min: 0,
  max: 24,
  defaultValue,
  unit: 'px'
})

const alpha = (surface: string, label: string): RangeControl => ({
  kind: 'range',
  key: `${surface}Alpha`,
  label,
  cssVar: `--ui-alpha-${surface}`,
  min: 0,
  max: 100,
  defaultValue: 100,
  unit: ''
})

export const UI_DEMO_CONTROLS: UiDemoControl[] = [
  radius('lane', 'Swimlane radius', 8),
  radius('card', 'Ticket card radius', 6),
  radius('modal', 'Modal radius', 8),
  radius('button', 'Button radius', 8),
  alpha('modal', 'Modal opacity %'),
  alpha('lane', 'Swimlane opacity %'),
  alpha('card', 'Ticket card opacity %'),
  {
    kind: 'choice',
    key: 'cardTextAlign',
    label: 'Card text justify',
    cssVar: '--ui-card-text-align',
    options: [
      { value: 'left', label: 'Left' },
      { value: 'center', label: 'Center' },
      { value: 'right', label: 'Right' }
    ],
    defaultValue: 'left'
  },
  {
    kind: 'choice',
    key: 'cardAlignItems',
    label: 'Card content align',
    cssVar: '--ui-card-align-items',
    options: [
      { value: 'start', label: 'Top' },
      { value: 'center', label: 'Middle' },
      { value: 'end', label: 'Bottom' }
    ],
    defaultValue: 'start'
  }
]

export const clampValue = (control: UiDemoControl, raw: unknown): number | string => {
  if (control.kind === 'choice') {
    const isAllowed = control.options.some((option) => option.value === raw)
    return isAllowed ? (raw as string) : control.defaultValue
  }
  const numeric = typeof raw === 'string' && raw.trim() === '' ? NaN : Number(raw)
  if (!Number.isFinite(numeric)) return control.defaultValue
  const rounded = Math.round(numeric)
  return Math.min(control.max, Math.max(control.min, rounded))
}

export const toCssValue = (control: UiDemoControl, value: number | string) =>
  control.kind === 'range' ? `${value}${control.unit}` : String(value)

export const defaultUiDemoValues = (): UiDemoValues =>
  Object.fromEntries(UI_DEMO_CONTROLS.map((control) => [control.key, control.defaultValue]))

export const normalizeUiDemoValues = (stored: unknown): UiDemoValues => {
  const source = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {}
  return Object.fromEntries(
    UI_DEMO_CONTROLS.map((control) => [control.key, clampValue(control, source[control.key])])
  )
}

const STORAGE_KEY = 'project-tracker-ui-demo'

type PanelPosition = { x: number; y: number }
type StoredUiDemo = { values?: unknown; position?: unknown }

const readStored = (): StoredUiDemo => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

const readPosition = (stored: unknown): PanelPosition | null => {
  const candidate = stored as Partial<PanelPosition> | null
  const x = candidate?.x
  const y = candidate?.y
  const isValid = Number.isFinite(x) && Number.isFinite(y)
  return isValid ? { x: x as number, y: y as number } : null
}

const initialStored = readStored()

export const uiDemoValues = reactive<UiDemoValues>(normalizeUiDemoValues(initialStored.values))
export const uiDemoPanelPosition = ref<PanelPosition | null>(readPosition(initialStored.position))
// Module scope so the panel's open state survives BoardView remounts within a session.
export const uiDemoPanelOpen = ref(false)
// ponytail: app-session only, never saved (same as laneModalSectionsOpen, #136)
export const settingsSectionsOpen = reactive({ metrics: false, display: false, ui: false })
export type SettingsSection = keyof typeof settingsSectionsOpen

export const applyUiDemo = (values: UiDemoValues = uiDemoValues) => {
  const rootStyle = document.documentElement.style
  for (const control of UI_DEMO_CONTROLS) {
    rootStyle.setProperty(control.cssVar, toCssValue(control, values[control.key]))
  }
}

export const saveUiDemo = () => {
  try {
    const payload = { values: { ...uiDemoValues }, position: uiDemoPanelPosition.value }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Storage full or unavailable: the knobs still work for this session.
  }
}

export const resetUiDemo = () => {
  Object.assign(uiDemoValues, defaultUiDemoValues())
}
