import { supabase } from "./supabase.js";
import { defaultAssumptions } from "./calc.js";

const BUCKET = "property-photos";

// ---------- ASSUMPTIONS ----------
export async function loadAssumptions() {
  const { data, error } = await supabase
    .from("assumptions")
    .select("data")
    .eq("id", 1)
    .single();
  if (error || !data) return { ...defaultAssumptions };
  // Merge so any new keys we add later fall back to defaults.
  return { ...defaultAssumptions, ...data.data };
}

export async function saveAssumptions(a) {
  const { error } = await supabase
    .from("assumptions")
    .upsert({ id: 1, data: a, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// ---------- PROPERTIES ----------
export async function loadProperties() {
  const { data, error } = await supabase
    .from("properties")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createProperty(partial = {}) {
  const { data, error } = await supabase
    .from("properties")
    .insert({ name: "New property", ...partial })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateProperty(id, patch) {
  const { error } = await supabase
    .from("properties")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteProperty(id) {
  const { error } = await supabase.from("properties").delete().eq("id", id);
  if (error) throw error;
}

// ---------- PHOTOS ----------
export async function loadPhotos(propertyId) {
  const { data, error } = await supabase
    .from("photos")
    .select("*")
    .eq("property_id", propertyId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map((row) => ({
    ...row,
    url: supabase.storage.from(BUCKET).getPublicUrl(row.storage_path).data.publicUrl,
  }));
}

export async function uploadPhoto(propertyId, file) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${propertyId}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (upErr) throw upErr;
  const { data, error } = await supabase
    .from("photos")
    .insert({ property_id: propertyId, storage_path: path })
    .select()
    .single();
  if (error) throw error;
  return {
    ...data,
    url: supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl,
  };
}

export async function deletePhoto(photo) {
  await supabase.storage.from(BUCKET).remove([photo.storage_path]);
  const { error } = await supabase.from("photos").delete().eq("id", photo.id);
  if (error) throw error;
}
