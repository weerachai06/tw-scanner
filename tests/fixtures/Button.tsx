import styles from './button.module.css'

// static property access
export function Button() {
  return <button className={styles.btn}>Click</button>
}

// bracket notation with string literal
export function Primary() {
  return <button className={styles['btnPrimary']}>Primary</button>
}

// non-existent class
export function Broken() {
  return <button className={styles.nonExistent}>Broken</button>
}

// dynamic access (should be skipped)
export function Dynamic({ variant }: { variant: string }) {
  return <button className={styles[variant]}>Dynamic</button>
}
