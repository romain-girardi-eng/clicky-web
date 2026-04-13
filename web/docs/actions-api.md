# Actions API

Actions are the tools the LLM is allowed to call. Each action has a name,
a human-readable description, a JSON Schema for its input, and an async
handler. Built-in actions cover the generic page-manipulation surface;
custom actions plug into your application logic.

## Defining a custom action

```ts
clicky.action({
  name: 'addToCart',
  description: 'Add a product to the user cart by id.',
  schema: {
    type: 'object',
    properties: {
      productId: { type: 'string', description: 'Catalog id of the product.' },
      quantity: { type: 'number' },
    },
    required: ['productId'],
  },
  handler: async ({ productId, quantity = 1 }) => {
    await store.cart.add(productId, quantity)
    return { ok: true, total: store.cart.total }
  },
})
```

The agent will see this tool, and can call it whenever the user expresses
intent that maps to it. Validation runs before the handler — bad calls are
fed back to the LLM as errors so it can self-correct.

## Built-in actions

| Name        | Purpose                                                                |
|-------------|------------------------------------------------------------------------|
| `highlight` | Spotlight an element on the page with an optional tooltip.            |
| `click`     | Click an element on the user's behalf.                                 |
| `fill`      | Set the value of an input or textarea and dispatch input/change.       |
| `navigate`  | Navigate to a URL via your `navigate` callback (or `location.assign`). |
| `read`      | Read the text content of an element (capped at 500 chars).             |
| `done`      | Mark the task as complete with a final user-facing message.            |

## Tips

- Keep descriptions short and action-oriented. The LLM picks tools based on
  the description, so "Add a product to the user cart" beats
  "Adds the given product id to the cart of the currently logged in user".
- Prefer narrow schemas. Required fields and `enum` constraints catch
  hallucinated arguments at validation time.
- Wrap handlers that close over rapidly-changing state with `useCallback`
  in React.
- Return small JSON objects from handlers. The result is fed back into the
  LLM context — large blobs eat tokens.
