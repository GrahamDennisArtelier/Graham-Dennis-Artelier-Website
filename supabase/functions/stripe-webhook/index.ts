import Stripe from 'npm:stripe@^22'
import { createClient } from 'npm:@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!)
const cryptoProvider = Stripe.createSubtleCryptoProvider()

function adminClient() {
  const secretMap = Deno.env.get('SUPABASE_SECRET_KEYS')
  const secret = secretMap ? JSON.parse(secretMap).default : Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  return createClient(Deno.env.get('SUPABASE_URL')!, secret!)
}

Deno.serve(async req => {
  const signature = req.headers.get('Stripe-Signature')
  const body = await req.text()
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature!, Deno.env.get('STRIPE_WEBHOOK_SECRET')!, undefined, cryptoProvider)
  } catch (error) {
    return new Response(`Webhook signature verification failed: ${error instanceof Error ? error.message : 'invalid signature'}`, { status: 400 })
  }

  const db = adminClient()
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object as Stripe.Checkout.Session
    const orderId = session.metadata?.order_id
    if (orderId) {
      const { data: order } = await db.from('orders').select('items').eq('id', orderId).single()
      await db.from('orders').update({
        status: 'paid', customer_email: session.customer_details?.email || session.customer_email || '',
        customer_name: session.customer_details?.name || '', shipping_address: session.customer_details?.address || null,
        amount_total: session.amount_total
      }).eq('id', orderId)
      for (const item of order?.items || []) {
        await db.from('artworks').update({ availability: 'sold', inventory_quantity: 0 }).eq('id', item.artwork_id)
      }
    }
  } else if (event.type === 'checkout.session.expired') {
    const session = event.data.object as Stripe.Checkout.Session
    if (session.metadata?.order_id) await db.from('orders').update({ status: 'expired' }).eq('id', session.metadata.order_id)
  }
  return Response.json({ received: true })
})
