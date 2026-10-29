(function () {
  const cfg = window.GD_SUPABASE_CONFIG || {};
  const configured = /^https:\/\/.+\.supabase\.co$/.test(cfg.url || '') && !!cfg.publishableKey;
  const client = configured && window.supabase
    ? window.supabase.createClient(cfg.url, cfg.publishableKey, { auth: { persistSession: true, autoRefreshToken: true } })
    : null;

  const cleanArtwork = row => ({
    id: row.id, t: row.title, m: row.medium, d: row.dimensions,
    p: Number(row.price), y: String(row.year_created || ''),
    collection_id: row.collection_id, c: row.collection?.name || row.collection_name || row.category || 'Uncategorised',
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
      const { data, error } = await client.from('artworks').select('*,collection:collections(id,name),artwork_images(*)').eq('status','published').order('sort_order');
      if (error) throw error;
      return data.map(cleanArtwork);
    },
    async collections() {
      if (!client) return null;
      const { data, error } = await client.from('collections').select('id,name').order('sort_order').order('name');
      if (error) throw error;
      return data;
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
    },
    async adminOverview() {
      if (!client) throw new Error('Supabase is not configured.');
      const [artworks, orders, enquiries] = await Promise.all([
        client.from('artworks').select('id,status', { count: 'exact' }),
        client.from('orders').select('id,status,amount_total,customer_email,created_at').order('created_at',{ascending:false}).limit(5),
        client.from('enquiries').select('id,status,name,email,inquiry_type,created_at').order('created_at',{ascending:false}).limit(5)
      ]);
      const error=artworks.error||orders.error||enquiries.error;if(error)throw error;
      return { artworks:artworks.data, orders:orders.data, enquiries:enquiries.data };
    },
    async adminArtworks() {
      const {data,error}=await client.from('artworks').select('*,collection:collections(name),artwork_images(*)').order('created_at',{ascending:false});
      if(error)throw error;return data;
    },
    async adminCollections() {
      if (!client) throw new Error('Supabase is not configured.');
      const {data,error}=await client.from('collections').select('*,artworks(id)').order('sort_order').order('name');
      if(error)throw error;
      return data.map(row=>({...row,artwork_count:row.artworks?.length||0}));
    },
    async createCollection(values) {
      if (!client) throw new Error('Supabase is not configured.');
      const base=values.name.trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'collection';
      const {data,error}=await client.from('collections').insert({name:values.name.trim(),description:values.description?.trim()||null,slug:`${base}-${Date.now().toString(36)}`}).select().single();
      if(error)throw error;return data;
    },
    async updateCollection(id, values) {
      if (!client) throw new Error('Supabase is not configured.');
      const {error}=await client.from('collections').update({
        name:values.name.trim(),
        description:values.description?.trim()||null
      }).eq('id',id);
      if(error)throw error;
    },
    async deleteCollection(id) {
      if (!client) throw new Error('Supabase is not configured.');
      const {error}=await client.from('collections').delete().eq('id',id);
      if(error)throw error;
    },
    async updateArtwork(id, values) { const {error}=await client.from('artworks').update(values).eq('id',id);if(error)throw error; },
    async deleteArtwork(id) { const {error}=await client.from('artworks').delete().eq('id',id);if(error)throw error; },
    async duplicateArtwork(id) {
      const {data,error}=await client.from('artworks').select('*').eq('id',id).single();if(error)throw error;
      delete data.id;delete data.created_at;delete data.updated_at;data.title=`${data.title} (Copy)`;data.slug=null;data.status='draft';data.featured=false;
      const inserted=await client.from('artworks').insert(data);if(inserted.error)throw inserted.error;
    },
    async adminOrders() { const {data,error}=await client.from('orders').select('*').order('created_at',{ascending:false});if(error)throw error;return data; },
    async updateOrder(id,status) { const {error}=await client.from('orders').update({status}).eq('id',id);if(error)throw error; },
    async adminEnquiries() { const {data,error}=await client.from('enquiries').select('*').order('created_at',{ascending:false});if(error)throw error;return data; },
    async updateEnquiry(id,status) { const {error}=await client.from('enquiries').update({status}).eq('id',id);if(error)throw error; },
    async homepage() { const {data,error}=await client.from('homepage_content').select('*').eq('id',1).maybeSingle();if(error)throw error;return data; },
    async updateHomepage(values) { const {error}=await client.from('homepage_content').upsert({id:1,...values,updated_at:new Date().toISOString()});if(error)throw error; },
    async uploadHomepageImage(file) {
      if (!file || !file.type.startsWith('image/')) throw new Error('Please choose an image file.');
      if (file.size > 12 * 1024 * 1024) throw new Error('The image must be smaller than 12 MB.');
      const extension=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'');
      const path=`site-content/homepage-${crypto.randomUUID()}.${extension}`;
      const {error}=await client.storage.from('artworks').upload(path,file,{cacheControl:'31536000',contentType:file.type});
      if(error)throw error;
      return client.storage.from('artworks').getPublicUrl(path).data.publicUrl;
    }
  };
})();
