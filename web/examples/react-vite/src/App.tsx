import { useState, useCallback } from 'react'
import { Routes, Route, Link, useNavigate } from 'react-router-dom'
import { ClickyProvider, ClickyWidget, useClickyReadable, useClickyAction } from '@clicky/react'
import { MockProvider } from '@clicky/core'

// Mock provider so the demo works offline. Replace with `apiUrl="/api/clicky"`
// (and remove the `provider` prop) once you have a real backend proxy.
const offlineProvider = new MockProvider()

interface CartItem {
  id: string
  name: string
  price: number
}

const PRODUCTS: CartItem[] = [
  { id: 'espresso', name: 'Espresso', price: 3.5 },
  { id: 'cappuccino', name: 'Cappuccino', price: 4.2 },
  { id: 'latte', name: 'Latte', price: 4.5 },
]

const useCart = () => {
  const [items, setItems] = useState<CartItem[]>([])
  const add = useCallback((id: string) => {
    const product = PRODUCTS.find((p) => p.id === id)
    if (product) setItems((prev) => [...prev, product])
  }, [])
  const total = items.reduce((sum, i) => sum + i.price, 0)
  return { items, add, total }
}

const Home = () => (
  <section>
    <h1>Welcome</h1>
    <p>This is a tiny demo app for the @clicky/react bindings.</p>
    <p>
      Open the floating button bottom-right and try: "Where is the cart?" or "Add an espresso to my cart".
    </p>
    <Link to="/products">Browse products</Link>
  </section>
)

const ProductsPage = ({ cart }: { cart: ReturnType<typeof useCart> }) => {
  useClickyReadable('currentRoute', '/products')

  useClickyAction({
    name: 'addToCart',
    description: 'Add a coffee product to the cart by id (espresso, cappuccino, latte).',
    schema: {
      type: 'object',
      properties: { product: { type: 'string' } },
      required: ['product'],
    },
    handler: ({ product }) => {
      cart.add(String(product))
      return { ok: true }
    },
  })

  return (
    <section>
      <h1>Products</h1>
      <ul>
        {PRODUCTS.map((p) => (
          <li key={p.id}>
            <strong>{p.name}</strong> — {p.price.toFixed(2)} EUR
            <button onClick={() => cart.add(p.id)} aria-label={`Add ${p.name}`}>
              Add
            </button>
          </li>
        ))}
      </ul>
      <Link to="/cart">Go to cart</Link>
    </section>
  )
}

const CartPage = ({ cart }: { cart: ReturnType<typeof useCart> }) => {
  const navigate = useNavigate()
  useClickyReadable('cartItems', cart.items.map((i) => i.name))
  useClickyReadable('cartTotal', cart.total)

  useClickyAction({
    name: 'goToCheckout',
    description: 'Navigate the user to the checkout page.',
    schema: { type: 'object', properties: {} },
    handler: () => {
      navigate('/checkout')
      return { ok: true }
    },
  })

  return (
    <section>
      <h1>Your cart</h1>
      {cart.items.length === 0 ? (
        <p>Empty.</p>
      ) : (
        <>
          <ul>
            {cart.items.map((i, idx) => (
              <li key={idx}>{i.name}</li>
            ))}
          </ul>
          <p>Total: {cart.total.toFixed(2)} EUR</p>
          <button data-testid="checkout-btn" onClick={() => navigate('/checkout')}>
            Checkout
          </button>
        </>
      )}
    </section>
  )
}

const CheckoutPage = () => (
  <section>
    <h1>Checkout</h1>
    <p>Pretend payment confirmation. Done.</p>
  </section>
)

export const App = () => {
  const cart = useCart()
  return (
    <ClickyProvider apiUrl="mock://" provider={offlineProvider} model="claude-sonnet-4-5" locale="en">
      <nav style={{ display: 'flex', gap: 12, padding: 16, borderBottom: '1px solid #ddd' }}>
        <Link to="/">Home</Link>
        <Link to="/products">Products</Link>
        <Link to="/cart">Cart ({cart.items.length})</Link>
      </nav>
      <main style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/products" element={<ProductsPage cart={cart} />} />
          <Route path="/cart" element={<CartPage cart={cart} />} />
          <Route path="/checkout" element={<CheckoutPage />} />
        </Routes>
      </main>
      <ClickyWidget />
    </ClickyProvider>
  )
}
