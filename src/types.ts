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
}

export interface ScanResult {
  invalid: ValidationResult[]
  dynamic: ExtractedClass[] // can't validate — report as warnings
  totalClasses: number
  totalFiles: number
  durationMs: number
}
