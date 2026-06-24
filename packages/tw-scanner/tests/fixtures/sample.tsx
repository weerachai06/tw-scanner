import { clsx } from 'clsx'
import { cva } from 'cva'

// className prop
export function Button() {
  return <button className="flex items-center bg-blue-500 text-white px-4 py-2 bg-brand-primary">Click</button>
}

// clsx call
export function Card({ active }: { active: boolean }) {
  return <div className={clsx('rounded-lg p-4', active && 'ring-2 ring-blue-500')} />
}

// cva variants
const badge = cva('inline-flex items-center rounded', {
  variants: {
    color: {
      green: 'bg-green-100 text-green-800',
      red: 'bg-red-100 text-red-800',
    },
  },
  defaultVariants: {
    color: 'green',
  },
})

// template literal with dynamic expression (should be flagged as dynamic)
export function Dynamic({ size }: { size: string }) {
  return <div className={`text-${size} font-bold`} />
}

// invalid class (for validator tests, not extractor)
export function Invalid() {
  return <div className="bg-nonexistent-500 text-fake-color" />
}
