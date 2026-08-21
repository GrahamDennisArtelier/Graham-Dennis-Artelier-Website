(function () {
  const cfg = window.GD_SUPABASE_CONFIG || {};
  const configured = /^https:\/\/.+\.supabase\.co$/.test(cfg.url || '') && !!cfg.publishableKey;
  const client = configured && window.supabase
    ? window.supabase.createClient(cfg.url, cfg.publishableKey, { auth: { persistSession: true, autoRefreshToken: true } })
    : null;

  const cleanArtwork = row => ({
    id: row.id, t: row.title, m: row.medium, d: row.dimensions,
    p: Number(row.price), y: String(row.year_created || ''),
    c: row.collection?.name || row.collection_name || 'Uncategorised',
    description: row.description, availability: row.availability,
    image: row.artwork_images?.find(x => x.is_hero)?.public_url || row.artwork_images?.[0]?.public_url || ''
  });

  window.GDBackend = {
    configured, client,
    async session() { if (!client) return null; return (await client.auth.getSession()).data.session; },
    async signIn(email, password) {
      if (!client) throw new Error('Add your Supabase URL and publishable key to supabase-config.js.');
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data;
    },
    async signOut() { if (client) await client.auth.signOut(); },
    async artworks() {
      if (!client) return null;
      const { data, error } = await client.from('artworks').select('*,collection:collections(name),artwork_images(*)').eq('status','published').order('sort_order');
      if (error) throw error;
      return data.map(cleanArtwork);
    },
    async enquiry(payload) {
      if (!client) return null;
      const { error } = await client.from('enquiries').insert(payload);
      if (error) throw error;
      return true;
    },
    async createArtwork(payload, files) {
      if (!client) return null;
      const { data, error } = await client.from('artworks').insert(payload).select().single();
      if (error) throw error;
      for (let i = 0; i < files.length; i++) {
        const safe = files[i].name.toLowerCase().replace(/[^a-z0-9.]+/g, '-');
        const path = `${data.id}/${crypto.randomUUID()}-${safe}`;
        const uploaded = await client.storage.from('artworks').upload(path, files[i], { cacheControl: '31536000' });
        if (uploaded.error) throw uploaded.error;
        const publicUrl = client.storage.from('artworks').getPublicUrl(path).data.publicUrl;
        const imageRow = await client.from('artwork_images').insert({ artwork_id: data.id, storage_path: path, public_url: publicUrl, is_hero: i === 0, sort_order: i });
        if (imageRow.error) throw imageRow.error;
      }
      return data;
    },
    async checkout(items) {
      if (!client) throw new Error('Supabase is not configured.');
      const artworkIds = items.map(item => item.id).filter(Boolean);
      if (artworkIds.length !== items.length) throw new Error('Please refresh the collection before checking out.');
      const response = await fetch(`${cfg.url}/functions/v1/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: cfg.publishableKey },
        body: JSON.stringify({ artworkIds })
      });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error || 'Checkout could not be started.');
      return result.url;
    }
  };
})();
