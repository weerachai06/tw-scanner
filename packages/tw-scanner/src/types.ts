export interface ExtractedClass {
  value: string
  file: string
  line: number
  col: number
  isDynamic: boolean // template literal with expressions: `bg-${x}`
  context: string // surrounding source snippet
}

export interface ValidationResult {
  cls: ExtractedClass
  valid: boolean
  isLikelyUtility: boolean
}

export interface CssModuleUsage {
  file: string        // JS/TS file using styles.xxx
  line: number
  col: number
  className: string   // e.g. 'btn'
  modulePath: string  // resolved absolute path to .module.css
  context: string
  isDynamic: boolean  // styles[variable]
}

export interface CssModuleViolation {
  file: string
  line: number
  col: number
  className: string
  modulePath: string
  context: string
}

export interface ScanResult {
  invalid: ValidationResult[]
  dynamic: ExtractedClass[] // can't validate — report as warnings
  cssModuleViolations: CssModuleViolation[]
  totalClasses: number
  totalFiles: number
  durationMs: number
}
