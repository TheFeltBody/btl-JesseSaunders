import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";

/* ------------------------------------------------------------------ *
 *  BTL Deal Analyser — "The Ledger"
 *  Supabase-connected: magic-link auth, properties + assumptions
 *  persisted. Adds auction/purchase fees, detail page, favourite /
 *  not-interested status, generic (no ST6).
 * ------------------------------------------------------------------ */

/* ---------- supabase (loaded from CDN at runtime) ---------- */
const SUPABASE_URL = "https://pfbzfybdmhurzzotjzfd.supabase.co";
const SUPABASE_KEY = "sb_publishable_2olAga7yVfZE-mWJg4Shxw_P5BPvRM2";
const ALLOWED_EMAILS = [
  "sdsproperty26@gmail.com",
  "chaim@btinternet.com",
  "moveme@jessesaunders.net",
];

// Dynamically import the supabase client so this runs in the artifact
// sandbox (no bundler / import map). Returns a singleton client.
let _clientPromise = null;
function getSupabase() {
  if (!_clientPromise) {
    _clientPromise = import("https://esm.sh/@supabase/supabase-js@2")
      .then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_KEY));
  }
  return _clientPromise;
}

/* ---------- photo storage (public bucket, matches original backend) ---------- */
const PHOTO_BUCKET = "property-photos";

// upload a File for a property, insert a photos row, return the row
async function uploadPhoto(sb, propertyId, file) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${propertyId}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await sb.storage
    .from(PHOTO_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (upErr) throw upErr;
  const { data, error } = await sb
    .from("photos")
    .insert({ property_id: propertyId, storage_path: path })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function listPhotos(sb, propertyId) {
  const { data, error } = await sb
    .from("photos")
    .select("*")
    .eq("property_id", propertyId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function deletePhoto(sb, photo) {
  await sb.storage.from(PHOTO_BUCKET).remove([photo.storage_path]);
  await sb.from("photos").delete().eq("id", photo.id);
}

const publicUrl = (sb, storagePath) =>
  sb.storage.from(PHOTO_BUCKET).getPublicUrl(storagePath).data.publicUrl;

// DB row (snake_case) -> app prop (camelCase). Values kept as strings for inputs.
const fromRow = (row) => ({
  id: row.id,
  name: row.name || "",
  area: row.area || "",
  listing_url: row.listing_url || "",
  asking: row.asking != null ? String(row.asking) : "",
  offer: row.offer != null ? String(row.offer) : "",
  rent: row.rent != null ? String(row.rent) : "",
  refurb: row.refurb != null ? String(row.refurb) : "",
  purchaseFees: row.purchase_fees != null ? String(row.purchase_fees) : "",
  notes: row.notes || "",
  status: row.status || "none",
  sort_order: row.sort_order ?? 0,
});

// app prop -> DB payload. Numerics coerced; empty -> null/0.
const toRow = (p) => ({
  name: p.name || "New property",
  area: p.area || null,
  listing_url: p.listing_url || null,
  asking: p.asking === "" ? null : num(p.asking),
  offer: p.offer === "" ? null : num(p.offer),
  rent: p.rent === "" ? null : num(p.rent),
  refurb: p.refurb === "" ? null : num(p.refurb),
  purchase_fees: p.purchaseFees === "" ? 0 : num(p.purchaseFees),
  notes: p.notes || null,
  status: p.status || "none",
  sort_order: p.sort_order ?? 0,
  updated_at: new Date().toISOString(),
});

/* ---------- engine ---------- */
const num = (t) => {
  const e = parseFloat(t);
  return isNaN(e) ? 0 : e;
};
const gbp = (t) =>
  (t < 0 ? "-" : "") + "£" + Math.abs(Math.round(t)).toLocaleString("en-GB");
const pct = (t) => (t * 100).toFixed(1) + "%";

// monthly mortgage payment (interest-only style amortised repayment)
function monthlyPayment(principal, rate, years) {
  const m = rate / 12;
  const n = years * 12;
  if (principal <= 0) return 0;
  if (m === 0) return principal / n;
  return (principal * m) / (1 - Math.pow(1 + m, -n));
}

const DEFAULTS = {
  equityReleased: 30000,
  extraSavings: 5000,
  erMonthly: 150,
  depositPct: 0.25,
  rate: 0.055,
  termYears: 25,
  sdltRate: 0.05,
  legal: 1500,
  survey: 600,
  arrangement: 999,
  broker: 500,
  misc: 500,
  agentPct: 0.1,
  insurance: 300,
  maintPct: 0.08,
  voidsPct: 0.05,
  compliance: 200,
  targetSelf: 200,
  targetAgent: 100,
  minYield: 0.08,
  maxBudget: 100000,
};

const workingCapital = (a) => a.equityReleased + a.extraSavings;

/*
 * KEY CHANGE — purchaseFees (auction reservation / buyer fees) are:
 *  - added to acquisition costs & cash required
 *  - EXCLUDED from SDLT (SDLT charged on purchase price only)
 *  - EXCLUDED from gross yield (yield on true purchase price)
 * This is the clean modelling discussed for the auction-fee gap.
 */
function analyse(p, a) {
  const offer = num(p.offer);
  const asking = num(p.asking);
  const rent = num(p.rent);
  const refurb = num(p.refurb);
  const purchaseFees = num(p.purchaseFees); // NEW

  const isEmpty = offer <= 0;

  const sdlt = offer * a.sdltRate; // on purchase price only
  const acqCosts =
    sdlt + a.legal + a.survey + a.arrangement + a.broker + a.misc + refurb + purchaseFees;
  const totalAcqCost = offer + acqCosts;

  const deposit = offer * a.depositPct;
  const loan = offer - deposit;

  // cash in includes deposit + all acquisition costs (incl. fees & refurb)
  const cashIn = deposit + acqCosts;
  const capitalRemaining = workingCapital(a) - cashIn;

  const annualRent = rent * 12;
  const mortgageAnnual = monthlyPayment(loan, a.rate, a.termYears) * 12;
  const agentFee = annualRent * a.agentPct;
  const maintenance = annualRent * a.maintPct;
  const voids = annualRent * a.voidsPct;
  const erAnnual = a.erMonthly * 12;

  const cashflowSelfAnnual =
    annualRent - mortgageAnnual - a.insurance - maintenance - voids - a.compliance - erAnnual;
  const cashflowSelfPcm = cashflowSelfAnnual / 12;
  const cashflowAgentAnnual = cashflowSelfAnnual - agentFee;
  const cashflowAgentPcm = cashflowAgentAnnual / 12;

  // gross yield on true purchase price (NOT inflated by fees)
  const grossYield = offer > 0 ? annualRent / offer : 0;
  // net yield reflects total cash basis (fees included)
  const netYield = totalAcqCost > 0 ? (cashflowSelfAnnual + erAnnual) / totalAcqCost : 0;
  const roi = cashIn > 0 ? cashflowSelfAnnual / cashIn : 0;

  return {
    isEmpty, offer, asking, rent, refurb, purchaseFees,
    sdlt, acqCosts, totalAcqCost, deposit, loan, cashIn, capitalRemaining,
    annualRent, mortgageAnnual, agentFee, maintenance, voids, erAnnual,
    cashflowSelfAnnual, cashflowSelfPcm, cashflowAgentAnnual, cashflowAgentPcm,
    grossYield, netYield, roi,
    hitsSelf: cashflowSelfPcm >= a.targetSelf,
    hitsAgent: cashflowAgentPcm >= a.targetAgent,
    hitsYield: grossYield >= a.minYield,
    withinBudget: offer > 0 && offer <= a.maxBudget,
  };
}

/* ---------- local optimistic prop (negative id until DB assigns one) ---------- */
let tmpId = -1;
const newProp = (over = {}) => ({
  id: tmpId--, // negative = not yet persisted
  name: "",
  area: "",
  listing_url: "",
  asking: "",
  offer: "",
  rent: "",
  refurb: "",
  purchaseFees: "",
  notes: "",
  status: "none", // none | favourite | rejected
  sort_order: 0,
  ...over,
});

/* ================================================================== */
export default function App() {
  /* --- supabase client (async loaded) --- */
  const [sb, setSb] = useState(null);
  const [clientErr, setClientErr] = useState("");

  /* --- auth --- */
  const [session, setSession] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    let alive = true;
    getSupabase()
      .then((client) => {
        if (!alive) return;
        setSb(client);
        client.auth.getSession().then(({ data }) => {
          if (!alive) return;
          setSession(data.session || null);
          setAuthChecked(true);
        });
        client.auth.onAuthStateChange((_e, s) => alive && setSession(s));
      })
      .catch((e) => alive && setClientErr(String(e)));
    return () => { alive = false; };
  }, []);

  if (clientErr) {
    return (
      <div style={S.page}>
        <style>{CSS}</style>
        <div style={S.authBox}>
          <div style={S.kicker}>The Ledger · Private</div>
          <h1 style={S.h1}>Connection problem</h1>
          <p style={S.sub}>Couldn't load the database client: {clientErr}</p>
        </div>
      </div>
    );
  }
  if (!sb || !authChecked) {
    return (
      <div style={S.page}>
        <style>{CSS}</style>
        <p style={S.empty}>Loading…</p>
      </div>
    );
  }
  if (!session) {
    return <SignIn sb={sb} />;
  }
  return <Ledger sb={sb} session={session} />;
}

/* ---------- sign-in (magic link) ---------- */
function SignIn({ sb }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const e = email.trim().toLowerCase();
    setErr("");
    if (!ALLOWED_EMAILS.includes(e)) {
      setErr("That email isn't on the access list.");
      return;
    }
    setBusy(true);
    const { error } = await sb.auth.signInWithOtp({
      email: e,
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setSent(true);
  };

  return (
    <div style={S.page}>
      <style>{CSS}</style>
      <div style={S.authBox}>
        <div style={S.kicker}>The Ledger · Private</div>
        <h1 style={S.h1}>Buy-to-Let Deal Analyser</h1>
        {sent ? (
          <p style={S.sub}>
            Check your inbox — a sign-in link is on its way to <b>{email.trim()}</b>. Open it on
            this device to continue.
          </p>
        ) : (
          <>
            <p style={S.sub}>Enter your email to receive a one-time sign-in link.</p>
            <div style={{ ...S.inputWrap, marginTop: 16, maxWidth: 360 }}>
              <input
                style={S.input}
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
              />
            </div>
            {err && <p style={{ ...S.sub, color: C.oxblood, marginTop: 8 }}>{err}</p>}
            <button style={{ ...S.btnPrimary, marginTop: 14 }} onClick={send} disabled={busy}>
              {busy ? "Sending…" : "Send sign-in link"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
function Ledger({ sb, session }) {
  const [assumptions, setAssumptions] = useState(DEFAULTS);
  const [props, setProps] = useState([]);
  const [openId, setOpenId] = useState(null); // detail page
  const [filter, setFilter] = useState("all"); // all | favourite | active | rejected
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncState, setSyncState] = useState("idle"); // idle | saving | saved | error

  /* --- initial load --- */
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const [{ data: rows, error: pErr }, { data: aRow }] = await Promise.all([
        sb.from("properties").select("*").order("sort_order", { ascending: true }).order("created_at", { ascending: true }),
        sb.from("assumptions").select("data").eq("id", 1).maybeSingle(),
      ]);
      if (!alive) return;
      if (!pErr && rows) setProps(rows.map(fromRow));
      if (aRow && aRow.data) setAssumptions({ ...DEFAULTS, ...aRow.data });
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [sb]);

  /* --- persist one property (debounced per id) --- */
  const timers = useRef({});
  const persistProp = useCallback((p) => {
    clearTimeout(timers.current[p.id]);
    timers.current[p.id] = setTimeout(async () => {
      setSyncState("saving");
      const payload = toRow(p);
      if (p.id < 0) {
        // insert new row, then swap temp id for the real one
        const { data, error } = await sb.from("properties").insert(payload).select().single();
        if (!error && data) {
          setProps((ps) => ps.map((x) => (x.id === p.id ? { ...fromRow(data) } : x)));
          setOpenId((cur) => (cur === p.id ? data.id : cur));
          setSyncState("saved");
        } else setSyncState("error");
      } else {
        const { error } = await sb.from("properties").update(payload).eq("id", p.id);
        setSyncState(error ? "error" : "saved");
      }
    }, 600);
  }, [sb]);

  /* --- persist assumptions (debounced) --- */
  const aTimer = useRef(null);
  const persistAssumptions = useCallback((a) => {
    clearTimeout(aTimer.current);
    aTimer.current = setTimeout(async () => {
      setSyncState("saving");
      const { error } = await sb
        .from("assumptions")
        .upsert({ id: 1, data: a, updated_at: new Date().toISOString() });
      setSyncState(error ? "error" : "saved");
    }, 600);
  }, [sb]);

  /* --- handlers (optimistic + write-through) --- */
  const updateProp = (id, key, value) =>
    setProps((ps) => {
      const next = ps.map((p) => (p.id === id ? { ...p, [key]: value } : p));
      const changed = next.find((p) => p.id === id);
      if (changed) persistProp(changed);
      return next;
    });

  const setStatus = (id, status) =>
    setProps((ps) => {
      const next = ps.map((p) =>
        p.id === id ? { ...p, status: p.status === status ? "none" : status } : p
      );
      const changed = next.find((p) => p.id === id);
      if (changed) persistProp(changed);
      return next;
    });

  const addProp = () => {
    const p = newProp({ sort_order: props.length });
    setProps((ps) => [...ps, p]);
    setOpenId(p.id);
    persistProp(p);
  };

  const removeProp = async (id) => {
    setProps((ps) => ps.filter((p) => p.id !== id));
    if (openId === id) setOpenId(null);
    if (id >= 0) {
      setSyncState("saving");
      const { error } = await sb.from("properties").delete().eq("id", id);
      setSyncState(error ? "error" : "saved");
    }
  };

  const updateAssumption = (key, value, isPct) =>
    setAssumptions((a) => {
      const next = { ...a, [key]: isPct ? num(value) / 100 : num(value) };
      persistAssumptions(next);
      return next;
    });

  const signOut = () => sb.auth.signOut();

  const visible = useMemo(() => {
    return props.filter((p) => {
      if (filter === "favourite") return p.status === "favourite";
      if (filter === "rejected") return p.status === "rejected";
      if (filter === "active") return p.status !== "rejected";
      return true;
    });
  }, [props, filter]);

  const openProp = props.find((p) => p.id === openId) || null;

  return (
    <div style={S.page}>
      <style>{CSS}</style>

      <header style={S.header}>
        <div>
          <div style={S.kicker}>The Ledger · Private</div>
          <h1 style={S.h1}>Buy-to-Let Deal Analyser</h1>
          <p style={S.sub}>
            Side-by-side appraisal of buy-to-let opportunities. Figures net the equity-release
            carry cost and check each deal against your cashflow targets. Auction and other
            purchase fees are modelled separately from SDLT and yield.
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <div style={S.syncRow}>
            <span style={S.syncDot(syncState)} />
            <span style={S.syncText}>
              {syncState === "saving" ? "Saving…" : syncState === "error" ? "Sync error" : syncState === "saved" ? "Saved" : "Synced"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={S.btnGhost} onClick={() => setShowAssumptions((s) => !s)}>
              {showAssumptions ? "Hide" : "Assumptions"}
            </button>
            <button style={S.btnGhost} onClick={signOut}>Sign out</button>
          </div>
        </div>
      </header>

      {showAssumptions && (
        <AssumptionsPanel a={assumptions} onChange={updateAssumption} />
      )}

      {loading && <p style={S.empty}>Loading your properties…</p>}

      {!loading && (openProp ? (
        <DetailPage
          sb={sb}
          p={openProp}
          a={assumptions}
          onBack={() => setOpenId(null)}
          onChange={updateProp}
          onStatus={setStatus}
          onRemove={removeProp}
        />
      ) : (
        <>
          <div style={S.toolbar}>
            <div style={S.filters}>
              {[
                ["all", "All"],
                ["active", "Active"],
                ["favourite", "Favourites"],
                ["rejected", "Not interested"],
              ].map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  style={{ ...S.filterBtn, ...(filter === k ? S.filterBtnOn : {}) }}
                >
                  {label}
                </button>
              ))}
            </div>
            <button style={S.btnPrimary} onClick={addProp}>+ New property</button>
          </div>

          <div style={S.cards}>
            {visible.length === 0 && (
              <p style={S.empty}>No properties in this view.</p>
            )}
            {visible.map((p) => (
              <PropertyCard
                key={p.id}
                p={p}
                r={analyse(p, assumptions)}
                onOpen={() => setOpenId(p.id)}
                onStatus={setStatus}
              />
            ))}
          </div>
          <p style={S.foot}>
            Indicative only. SDLT uses a flat surcharge approximation — confirm banded rates on a
            specific price with a solicitor. Auction reservation fees may count as chargeable
            consideration for SDLT under some auction rules; verify before offering.
          </p>
        </>
      ))}
    </div>
  );
}

/* ---------- property card (summary) ---------- */
function StatusPips({ status, onStatus, id }) {
  return (
    <div style={S.pips} onClick={(e) => e.stopPropagation()}>
      <button
        title="Favourite"
        onClick={() => onStatus(id, "favourite")}
        style={{ ...S.pip, ...(status === "favourite" ? S.pipFav : {}) }}
      >
        ★
      </button>
      <button
        title="Not interested"
        onClick={() => onStatus(id, "rejected")}
        style={{ ...S.pip, ...(status === "rejected" ? S.pipRej : {}) }}
      >
        ✕
      </button>
    </div>
  );
}

function PropertyCard({ p, r, onOpen, onStatus }) {
  const dimmed = p.status === "rejected";
  return (
    <div
      style={{ ...S.card, ...(dimmed ? S.cardDim : {}), ...(p.status === "favourite" ? S.cardFav : {}) }}
      onClick={onOpen}
    >
      <div style={S.cardTop}>
        <div>
          <div style={S.cardName}>{p.name || "Untitled property"}</div>
          <div style={S.cardArea}>{p.area || "—"}</div>
        </div>
        <StatusPips status={p.status} onStatus={onStatus} id={p.id} />
      </div>

      <div style={S.metricRow}>
        <Metric label="Offer" value={r.offer ? gbp(r.offer) : "—"} />
        <Metric label="Rent /mo" value={r.rent ? gbp(r.rent) : "—"} />
        <Metric label="Gross yield" value={r.offer ? pct(r.grossYield) : "—"} good={r.hitsYield} />
      </div>
      <div style={S.metricRow}>
        <Metric label="Cash in" value={r.offer ? gbp(r.cashIn) : "—"} />
        <Metric label="Cashflow /mo (self)" value={r.offer ? gbp(r.cashflowSelfPcm) : "—"} good={r.hitsSelf} />
        <Metric label="Capital left" value={r.offer ? gbp(r.capitalRemaining) : "—"} />
      </div>

      {Number(p.purchaseFees) > 0 && (
        <div style={S.feeTag}>incl. {gbp(num(p.purchaseFees))} purchase fees</div>
      )}
      <div style={S.openHint}>View full breakdown →</div>
    </div>
  );
}

function Metric({ label, value, good }) {
  return (
    <div style={S.metric}>
      <div style={S.metricLabel}>{label}</div>
      <div style={{ ...S.metricValue, ...(good === true ? S.good : good === false ? S.bad : {}) }}>
        {value}
      </div>
    </div>
  );
}

/* ---------- detail page ---------- */
function Field({ label, value, onChange, prefix, placeholder, full }) {
  return (
    <div style={{ ...S.field, ...(full ? { gridColumn: "1 / -1" } : {}) }}>
      <label style={S.label}>{label}</label>
      <div style={S.inputWrap}>
        {prefix && <span style={S.prefix}>{prefix}</span>}
        <input
          style={{ ...S.input, ...(prefix ? { paddingLeft: 22 } : {}) }}
          value={value || ""}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

function Line({ label, value, strong, good, indent, accent }) {
  return (
    <div style={{ ...S.line, ...(strong ? S.lineStrong : {}) }}>
      <span style={{ ...S.lineLabel, ...(indent ? { paddingLeft: 16 } : {}) }}>{label}</span>
      <span
        style={{
          ...S.lineValue,
          ...(strong ? { fontWeight: 700 } : {}),
          ...(good === true ? S.good : good === false ? S.bad : {}),
          ...(accent ? { color: "var(--oxblood)" } : {}),
        }}
      >
        {value}
      </span>
    </div>
  );
}

/* ---------- photo gallery ---------- */
function PhotoGallery({ sb, propertyId }) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);

  const unsaved = propertyId < 0; // property not yet persisted

  useEffect(() => {
    let alive = true;
    if (unsaved) { setLoading(false); return; }
    setLoading(true);
    listPhotos(sb, propertyId)
      .then((rows) => alive && setPhotos(rows))
      .catch((e) => alive && setErr(String(e.message || e)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [sb, propertyId, unsaved]);

  const onPick = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setErr("");
    setBusy(true);
    try {
      for (const f of files) {
        const row = await uploadPhoto(sb, propertyId, f);
        setPhotos((ps) => [...ps, row]);
      }
    } catch (e2) {
      setErr(String(e2.message || e2));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onDelete = async (photo) => {
    setErr("");
    const prev = photos;
    setPhotos((ps) => ps.filter((x) => x.id !== photo.id)); // optimistic
    try {
      await deletePhoto(sb, photo);
    } catch (e2) {
      setErr(String(e2.message || e2));
      setPhotos(prev); // rollback
    }
  };

  return (
    <div style={{ marginTop: 18 }}>
      <div style={S.section}>Photos</div>
      {unsaved ? (
        <p style={S.photoHint}>Save the property first (add an offer or name) to attach photos.</p>
      ) : (
        <>
          <div style={S.photoGrid}>
            {photos.map((ph) => (
              <div key={ph.id} style={S.thumb}>
                <img src={publicUrl(sb, ph.storage_path)} alt="" style={S.thumbImg} />
                <button style={S.thumbDel} title="Delete photo" onClick={() => onDelete(ph)}>✕</button>
              </div>
            ))}
            <button
              style={S.addPhoto}
              onClick={() => fileRef.current && fileRef.current.click()}
              disabled={busy}
            >
              {busy ? "Uploading…" : "+ Add photo"}
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={onPick}
          />
          {loading && <p style={S.photoHint}>Loading photos…</p>}
          {err && <p style={{ ...S.photoHint, color: C.oxblood }}>{err}</p>}
        </>
      )}
    </div>
  );
}

function DetailPage({ sb, p, a, onBack, onChange, onStatus, onRemove }) {
  const r = analyse(p, a);
  const set = (k) => (v) => onChange(p.id, k, v);
  return (
    <div>
      <div style={S.detailNav}>
        <button style={S.btnGhost} onClick={onBack}>← All properties</button>
        <div style={S.pips}>
          <button
            onClick={() => onStatus(p.id, "favourite")}
            style={{ ...S.pip, ...(p.status === "favourite" ? S.pipFav : {}) }}
          >
            ★ Favourite
          </button>
          <button
            onClick={() => onStatus(p.id, "rejected")}
            style={{ ...S.pip, ...(p.status === "rejected" ? S.pipRej : {}) }}
          >
            ✕ Not interested
          </button>
        </div>
      </div>

      <div style={S.detailGrid}>
        {/* left: inputs */}
        <div style={S.panel}>
          <div style={S.panelTitle}>Property</div>
          <div style={S.fieldGrid}>
            <Field label="Name" value={p.name} onChange={set("name")} full placeholder="Street name" />
            <Field label="Area / type" value={p.area} onChange={set("area")} full placeholder="e.g. 4-bed terrace" />
            <Field label="Listing URL" value={p.listing_url} onChange={set("listing_url")} full placeholder="https://…" />
            <Field label="Asking price" value={p.asking} onChange={set("asking")} prefix="£" />
            <Field label="Your offer" value={p.offer} onChange={set("offer")} prefix="£" />
            <Field label="Rent (pcm)" value={p.rent} onChange={set("rent")} prefix="£" />
            <Field label="Refurb" value={p.refurb} onChange={set("refurb")} prefix="£" />
            <Field
              label="Purchase fees (auction etc.)"
              value={p.purchaseFees}
              onChange={set("purchaseFees")}
              prefix="£"
              full
            />
            <Field label="Notes" value={p.notes} onChange={set("notes")} full placeholder="Observations…" />
          </div>

          <PhotoGallery sb={sb} propertyId={p.id} />

          {p.listing_url ? (
            <a style={S.listingLink} href={p.listing_url} target="_blank" rel="noreferrer">
              Open listing ↗
            </a>
          ) : null}
          <button style={S.btnDanger} onClick={() => onRemove(p.id)}>Delete property</button>
        </div>

        {/* right: full financial breakdown */}
        <div style={S.panel}>
          <div style={S.panelTitle}>{p.name || "Property"} — full breakdown</div>

          <div style={S.section}>Acquisition</div>
          <Line label="Purchase price (offer)" value={gbp(r.offer)} />
          <Line label={`SDLT @ ${pct(a.sdltRate)} (on price only)`} value={gbp(r.sdlt)} indent />
          <Line label="Legal" value={gbp(a.legal)} indent />
          <Line label="Survey" value={gbp(a.survey)} indent />
          <Line label="Mortgage arrangement" value={gbp(a.arrangement)} indent />
          <Line label="Broker" value={gbp(a.broker)} indent />
          <Line label="Misc" value={gbp(a.misc)} indent />
          <Line label="Refurb" value={gbp(r.refurb)} indent />
          <Line label="Purchase fees (auction etc.)" value={gbp(r.purchaseFees)} indent accent />
          <Line label="Total acquisition costs" value={gbp(r.acqCosts)} strong />
          <Line label="Total cost basis" value={gbp(r.totalAcqCost)} strong />

          <div style={S.section}>Financing & cash</div>
          <Line label={`Deposit @ ${pct(a.depositPct)}`} value={gbp(r.deposit)} />
          <Line label="Mortgage loan" value={gbp(r.loan)} />
          <Line label="Cash required (deposit + costs + fees)" value={gbp(r.cashIn)} strong />
          <Line
            label="Capital remaining after deal"
            value={gbp(r.capitalRemaining)}
            strong
            good={r.capitalRemaining >= 0}
          />

          <div style={S.section}>Annual cashflow</div>
          <Line label="Gross rent" value={gbp(r.annualRent)} />
          <Line label={`Mortgage @ ${pct(a.rate)} / ${a.termYears}yr`} value={"-" + gbp(r.mortgageAnnual)} indent />
          <Line label="Insurance" value={"-" + gbp(a.insurance)} indent />
          <Line label={`Maintenance @ ${pct(a.maintPct)}`} value={"-" + gbp(r.maintenance)} indent />
          <Line label={`Voids @ ${pct(a.voidsPct)}`} value={"-" + gbp(r.voids)} indent />
          <Line label="Compliance" value={"-" + gbp(a.compliance)} indent />
          <Line label={`Equity-release carry (${gbp(a.erMonthly)}/mo)`} value={"-" + gbp(r.erAnnual)} indent />
          <Line label="Net cashflow — self-managed" value={gbp(r.cashflowSelfAnnual)} strong good={r.cashflowSelfAnnual > 0} />
          <Line label={`Letting agent @ ${pct(a.agentPct)}`} value={"-" + gbp(r.agentFee)} indent />
          <Line label="Net cashflow — with agent" value={gbp(r.cashflowAgentAnnual)} strong good={r.cashflowAgentAnnual > 0} />

          <div style={S.section}>Monthly & returns</div>
          <Line label="Cashflow /mo — self-managed" value={gbp(r.cashflowSelfPcm)} good={r.hitsSelf} />
          <Line label="Cashflow /mo — with agent" value={gbp(r.cashflowAgentPcm)} good={r.hitsAgent} />
          <Line label="Gross yield (on price)" value={pct(r.grossYield)} good={r.hitsYield} />
          <Line label="Net yield (on cost basis)" value={pct(r.netYield)} />
          <Line label="ROI on cash in" value={pct(r.roi)} />

          <div style={S.targetRow}>
            <TargetChip ok={r.hitsSelf} label={`Self ≥ ${gbp(a.targetSelf)}/mo`} />
            <TargetChip ok={r.hitsAgent} label={`Agent ≥ ${gbp(a.targetAgent)}/mo`} />
            <TargetChip ok={r.hitsYield} label={`Yield ≥ ${pct(a.minYield)}`} />
            <TargetChip ok={r.withinBudget} label={`≤ ${gbp(a.maxBudget)}`} />
          </div>
        </div>
      </div>
    </div>
  );
}

function TargetChip({ ok, label }) {
  return (
    <span style={{ ...S.chip, ...(ok ? S.chipOk : S.chipNo) }}>
      {ok ? "✓" : "✕"} {label}
    </span>
  );
}

/* ---------- assumptions ---------- */
function AssumptionsPanel({ a, onChange }) {
  const rows = [
    ["equityReleased", "Equity released", "£", false],
    ["extraSavings", "Extra savings", "£", false],
    ["erMonthly", "Equity-release carry /mo", "£", false],
    ["depositPct", "Deposit", "%", true],
    ["rate", "Mortgage rate", "%", true],
    ["termYears", "Term (yrs)", "", false],
    ["sdltRate", "SDLT surcharge", "%", true],
    ["legal", "Legal", "£", false],
    ["survey", "Survey", "£", false],
    ["arrangement", "Arrangement", "£", false],
    ["broker", "Broker", "£", false],
    ["misc", "Misc", "£", false],
    ["agentPct", "Agent fee", "%", true],
    ["insurance", "Insurance /yr", "£", false],
    ["maintPct", "Maintenance", "%", true],
    ["voidsPct", "Voids", "%", true],
    ["compliance", "Compliance /yr", "£", false],
    ["targetSelf", "Self target /mo", "£", false],
    ["targetAgent", "Agent target /mo", "£", false],
    ["minYield", "Min gross yield", "%", true],
    ["maxBudget", "Max budget", "£", false],
  ];
  return (
    <div style={S.assumptions}>
      {rows.map(([key, label, suffix, isPct]) => (
        <div key={key} style={S.aRow}>
          <label style={S.aLabel}>{label}</label>
          <div style={S.inputWrap}>
            {suffix === "£" && <span style={S.prefix}>£</span>}
            <input
              style={{ ...S.input, ...(suffix === "£" ? { paddingLeft: 22 } : {}) }}
              value={isPct ? +(a[key] * 100).toFixed(2) : a[key]}
              onChange={(e) => onChange(key, e.target.value, isPct)}
            />
            {suffix === "%" && <span style={S.suffix}>%</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- styles ---------- */
const C = {
  paper: "#f4f0e8", card: "#faf8f2", ink: "#1c1a16", inkSoft: "#4a463d",
  inkFaint: "#87806f", rule: "#d8d0be", ruleStrong: "#b8ad95",
  oxblood: "#7c2d2d", oxbloodSoft: "#a14a43", forest: "#2f5042",
  forestSoft: "#e2ebe4", redSoft: "#f3e0dd", gold: "#b08316",
};
const mono = "'Spline Sans Mono', ui-monospace, monospace";
const serif = "'Fraunces', Georgia, serif";
const sans = "'Inter Tight', system-ui, sans-serif";

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Spline+Sans+Mono:wght@400;500;600&family=Inter+Tight:wght@400;500;600;700&display=swap');
* { box-sizing: border-box; }
input:focus { outline: none; border-color: ${C.oxblood} !important; }
button { cursor: pointer; font-family: ${sans}; }
::selection { background: ${C.redSoft}; }
`;

const S = {
  page: { fontFamily: sans, background: C.paper, color: C.ink, minHeight: "100vh", padding: "28px 22px 60px", maxWidth: 1180, margin: "0 auto" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, borderBottom: `2px solid ${C.ink}`, paddingBottom: 18, marginBottom: 22 },
  kicker: { fontFamily: mono, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: C.oxblood, marginBottom: 6 },
  h1: { fontFamily: serif, fontWeight: 600, fontSize: 34, margin: "0 0 8px", lineHeight: 1.05 },
  sub: { fontSize: 14, color: C.inkSoft, maxWidth: 720, margin: 0, lineHeight: 1.5 },
  toolbar: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 12 },
  filters: { display: "flex", gap: 6, flexWrap: "wrap" },
  filterBtn: { fontFamily: mono, fontSize: 12, padding: "7px 13px", border: `1px solid ${C.ruleStrong}`, background: "transparent", color: C.inkSoft, borderRadius: 2 },
  filterBtnOn: { background: C.ink, color: C.paper, borderColor: C.ink },
  btnPrimary: { fontSize: 13, fontWeight: 600, padding: "9px 16px", background: C.oxblood, color: "#fff", border: "none", borderRadius: 2 },
  btnGhost: { fontSize: 13, fontWeight: 500, padding: "8px 14px", background: "transparent", color: C.ink, border: `1px solid ${C.ruleStrong}`, borderRadius: 2 },
  btnDanger: { fontSize: 12, fontWeight: 500, padding: "9px 14px", background: "transparent", color: C.oxblood, border: `1px solid ${C.oxbloodSoft}`, borderRadius: 2, marginTop: 14, width: "100%" },
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: 16 },
  card: { background: C.card, border: `1px solid ${C.rule}`, borderRadius: 4, padding: 18, cursor: "pointer", boxShadow: "0 1px 2px rgba(28,26,22,.06), 0 8px 24px rgba(28,26,22,.05)", transition: "transform .12s, box-shadow .12s", position: "relative" },
  cardFav: { borderColor: C.gold, borderLeftWidth: 4, borderLeftColor: C.gold },
  cardDim: { opacity: 0.5 },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 },
  cardName: { fontFamily: serif, fontSize: 19, fontWeight: 600, lineHeight: 1.1 },
  cardArea: { fontSize: 12.5, color: C.inkFaint, marginTop: 3 },
  metricRow: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 },
  metric: {},
  metricLabel: { fontFamily: mono, fontSize: 9.5, letterSpacing: 0.6, textTransform: "uppercase", color: C.inkFaint, marginBottom: 3 },
  metricValue: { fontFamily: mono, fontSize: 15, fontWeight: 500 },
  good: { color: C.forest }, bad: { color: C.oxblood },
  feeTag: { display: "inline-block", fontFamily: mono, fontSize: 10.5, color: C.oxblood, background: C.redSoft, padding: "2px 8px", borderRadius: 2, marginTop: 2 },
  openHint: { fontFamily: mono, fontSize: 11, color: C.inkFaint, marginTop: 12, textAlign: "right" },
  pips: { display: "flex", gap: 6 },
  pip: { fontSize: 13, lineHeight: 1, padding: "5px 9px", border: `1px solid ${C.rule}`, background: C.paper, color: C.inkFaint, borderRadius: 2 },
  pipFav: { background: C.gold, color: "#fff", borderColor: C.gold },
  pipRej: { background: C.oxblood, color: "#fff", borderColor: C.oxblood },
  empty: { color: C.inkFaint, fontStyle: "italic" },
  foot: { fontSize: 11.5, color: C.inkFaint, marginTop: 26, lineHeight: 1.5, borderTop: `1px solid ${C.rule}`, paddingTop: 14 },
  // detail
  detailNav: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 10 },
  detailGrid: { display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: 20, alignItems: "start" },
  panel: { background: C.card, border: `1px solid ${C.rule}`, borderRadius: 4, padding: 20 },
  panelTitle: { fontFamily: serif, fontSize: 20, fontWeight: 600, marginBottom: 16, paddingBottom: 10, borderBottom: `1px solid ${C.rule}` },
  fieldGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  field: { display: "flex", flexDirection: "column" },
  label: { fontFamily: mono, fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase", color: C.inkFaint, marginBottom: 5 },
  inputWrap: { position: "relative", display: "flex", alignItems: "center" },
  prefix: { position: "absolute", left: 9, fontFamily: mono, fontSize: 13, color: C.inkFaint },
  suffix: { position: "absolute", right: 9, fontFamily: mono, fontSize: 13, color: C.inkFaint },
  input: { width: "100%", fontFamily: mono, fontSize: 13.5, padding: "8px 10px", border: `1px solid ${C.ruleStrong}`, borderRadius: 2, background: C.paper, color: C.ink },
  listingLink: { display: "inline-block", marginTop: 14, fontSize: 13, color: C.forest, fontWeight: 600, textDecoration: "none" },
  photoGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))", gap: 8 },
  thumb: { position: "relative", aspectRatio: "1 / 1", borderRadius: 3, overflow: "hidden", border: `1px solid ${C.rule}` },
  thumbImg: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  thumbDel: { position: "absolute", top: 3, right: 3, width: 20, height: 20, lineHeight: "18px", padding: 0, fontSize: 11, color: "#fff", background: "rgba(28,26,22,.72)", border: "none", borderRadius: "50%" },
  addPhoto: { aspectRatio: "1 / 1", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: mono, fontSize: 11.5, color: C.inkSoft, background: C.paper, border: `1px dashed ${C.ruleStrong}`, borderRadius: 3, textAlign: "center", padding: 4 },
  photoHint: { fontSize: 12, color: C.inkFaint, marginTop: 8, fontStyle: "italic" },
  section: { fontFamily: mono, fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: C.oxblood, margin: "20px 0 8px", paddingBottom: 5, borderBottom: `1px solid ${C.rule}` },
  line: { display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13.5, color: C.inkSoft },
  lineStrong: { borderTop: `1px solid ${C.rule}`, marginTop: 4, paddingTop: 8, color: C.ink, fontWeight: 600 },
  lineLabel: {}, lineValue: { fontFamily: mono },
  targetRow: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 18 },
  chip: { fontFamily: mono, fontSize: 11.5, padding: "5px 10px", borderRadius: 2 },
  chipOk: { background: C.forestSoft, color: C.forest }, chipNo: { background: C.redSoft, color: C.oxblood },
  assumptions: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12, background: C.card, border: `1px solid ${C.rule}`, borderRadius: 4, padding: 18, marginBottom: 22 },
  aRow: { display: "flex", flexDirection: "column" },
  aLabel: { fontFamily: mono, fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase", color: C.inkFaint, marginBottom: 5 },
  authBox: { maxWidth: 520, margin: "12vh auto 0", background: C.card, border: `1px solid ${C.rule}`, borderRadius: 4, padding: 32, boxShadow: "0 1px 2px rgba(28,26,22,.06), 0 8px 24px rgba(28,26,22,.05)" },
  syncRow: { display: "flex", alignItems: "center", gap: 6 },
  syncDot: (s) => ({ width: 8, height: 8, borderRadius: "50%", background: s === "error" ? C.oxblood : s === "saving" ? C.gold : C.forest, transition: "background .2s" }),
  syncText: { fontFamily: mono, fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase", color: C.inkFaint },
};
