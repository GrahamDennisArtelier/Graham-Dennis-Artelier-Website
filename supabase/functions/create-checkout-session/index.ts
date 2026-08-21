import Stripe from 'npm:stripe@^22'
import { createClient } from 'npm:@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!)
const siteUrl = (Deno.env.get('SITE_URL') || 'https://www.grahamdennisartelier.co.uk').replace(/\/$/, '')
const allowedOrigins = new Set((Deno.env.get('ALLOWED_ORIGINS') ||
  'https://www.grahamdennisartelier.co.uk,https://grahamdennisartelier.co.uk')
  .split(',').map(value => value.trim().replace(/\/$/, '')).filter(Boolean))
const corsFor = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin) ? origin : siteUrl,
  'Access-Control-Allow-Headers': 'apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
})

function adminClient() {
  const secretMap = Deno.env.get('SUPABASE_SECRET_KEYS')
  const secret = secretMap ? JSON.parse(secretMap).default : Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  return createClient(Deno.env.get('SUPABASE_URL')!, secret!)
}

Deno.serve(async req => {
  const origin = req.headers.get('Origin')
  const cors = corsFor(origin)
  if (origin && !allowedOrigins.has(origin)) return Response.json({ error: 'Origin not allowed' }, { status: 403, headers: cors })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors })
  try {
    const { artworkIds } = await req.json()
    if (!Array.isArray(artworkIds) || !artworkIds.length || artworkIds.length > 20) {
      return Response.json({ error: 'A valid cart is required' }, { status: 400, headers: cors })
    }
    const uniqueIds = [...new Set(artworkIds.filter(id => typeof id === 'string'))]
    const db = adminClient()
    const { data: artworks, error } = await db.from('artworks')
      .select('id,title,price,availability,inventory_quantity,status')
      .in('id', uniqueIds).eq('status', 'published')
    if (error) throw error
    if (!artworks || artworks.length !== uniqueIds.length) throw new Error('One or more artworks are unavailable')
    if (artworks.some(a => a.availability !== 'available' || a.inventory_quantity < 1)) throw new Error('One or more artworks have sold')

    const amountTotal = artworks.reduce((sum, a) => sum + Math.round(Number(a.price) * 100), 0)
    const { data: order, error: orderError } = await db.from('orders').insert({
      customer_email: 'pending@checkout.local', amount_total: amountTotal, currency: 'gbp',
      status: 'pending', items: artworks.map(a => ({ artwork_id: a.id, title: a.title, unit_amount: Math.round(Number(a.price) * 100) }))
    }).select('id').single()
    if (orderError) throw orderError

    const session = await stripe.checkout.sessions.create({
      mode: 'payment', customer_creation: 'always', billing_address_collection: 'required',
      shipping_address_collection: { allowed_countries: ['GB','US','CA','AU','NZ','IE','FR','DE','NL','BE','ES','IT'] },
      line_items: artworks.map(a => ({ quantity: 1, price_data: {
        currency: 'gbp', unit_amount: Math.round(Number(a.price) * 100),
        product_data: { name: a.title, description: 'Original artwork by Graham Dennis' }
      }})),
      metadata: { order_id: order.id },
      success_url: `${siteUrl}/gallery.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/gallery.html?checkout=cancel`,
    })
    await db.from('orders').update({ stripe_checkout_session_id: session.id }).eq('id', order.id)
    return Response.json({ url: session.url }, { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (error) {
    console.error(error)
    return Response.json({ error: error instanceof Error ? error.message : 'Checkout could not be created' }, { status: 400, headers: cors })
  }
})
