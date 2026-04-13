'use client'

import { useClickyReadable } from '@clicky/react'

const PRODUCTS = [
  { id: 'espresso', name: 'Espresso', price: 3.5 },
  { id: 'cappuccino', name: 'Cappuccino', price: 4.2 },
  { id: 'latte', name: 'Latte', price: 4.5 },
]

export default function ProductsPage() {
  useClickyReadable('currentRoute', '/products')
  useClickyReadable('catalog', PRODUCTS.map((p) => p.name))

  return (
    <main style={{ padding: 32, maxWidth: 720, margin: '0 auto', fontFamily: 'system-ui' }}>
      <h1>Products</h1>
      <ul>
        {PRODUCTS.map((p) => (
          <li key={p.id}>
            <strong>{p.name}</strong> — {p.price.toFixed(2)} EUR
            <button aria-label={`Add ${p.name}`} style={{ marginLeft: 12 }}>
              Add to cart
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}
