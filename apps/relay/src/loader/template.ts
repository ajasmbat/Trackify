// Body of the tracking snippet the relay serves at `/l/<loaderPath>.js`.
//
// Everything the snippet does at runtime is designed to defeat pattern-based
// ad blockers:
//   * Identifier names are short and semantically opaque — nothing like
//     `pixel`, `fbq`, or `track` appears in the source.
//   * The ingest URL is assembled from concatenated locals, so the string
//     literal `/e` never appears in the snippet body.
//   * The Meta pixel is not referenced by name from inside the snippet. The
//     snippet is a first-party POST vehicle only; the browser pixel (T8) is
//     the concern of `apps/storefront/lib/tracking/pixel.ts` and stays intact.
//
// The snippet still emits the same `CanonicalEvent` shape as the T8 client
// and carries the same `event_id` UUID / `journey_id` cookie continuity
// contract, so both delivery vehicles round-trip through the relay
// identically. A same-page duplicate is a de-dupe concern for the relay,
// not for the snippet.
//
// Server-substitution slots — the build step replaces these tokens with the
// real per-tenant values before returning bytes to the browser.

export const SLOT_TENANT_ID = "__TF_TID__";
export const SLOT_HOST = "__TF_HOST__";
export const SLOT_EP = "__TF_EP__";
export const SLOT_JID_COOKIE = "__TF_JID__";
export const SLOT_VID_COOKIE = "__TF_VID__";

// Constants echoed into the snippet for symmetry with the T8 client. Keep the
// two lists in sync when either side adds a new event name.
export const EVENT_NAMES = [
  "page_view",
  "view_item",
  "add_to_cart",
  "begin_checkout",
  "user_identified",
  "purchase",
] as const;

const UNLOAD_SAFE = ["purchase", "begin_checkout"] as const;

// The snippet body. Kept in one file so a review of the emitted bytes has a
// single place to look. Identifiers inside are one-to-three chars; the
// TEMPLATE itself contains no `//` line comments so a comment that happened
// to include a backtick or a `${...}` sequence can never terminate this
// outer template literal. All narrative belongs above, not inside.
export const TEMPLATE = `(function(w,d,n){
if(w.__tf_l)return;w.__tf_l=1;
var T=${JSON.stringify(SLOT_TENANT_ID)};
var H=${JSON.stringify(SLOT_HOST)};
var E=${JSON.stringify(SLOT_EP)};
var JC=${JSON.stringify(SLOT_JID_COOKIE)};
var VC=${JSON.stringify(SLOT_VID_COOKIE)};
var NS=${JSON.stringify(EVENT_NAMES)};
var US=${JSON.stringify(UNLOAD_SAFE)};
function rc(k){var m=(d.cookie||"").match(new RegExp("(?:^|; )"+k.replace(/([.$?*|{}()[\\]\\/+^])/g,"\\\\$1")+"=([^;]*)"));return m?decodeURIComponent(m[1]):""}
function wc(k,v,a){var b=k+"="+encodeURIComponent(v)+"; path=/; max-age="+a+"; SameSite=Lax";try{d.cookie=b}catch(e){}}
function u(){var b=new Uint8Array(16);(w.crypto||w.msCrypto).getRandomValues(b);b[6]=b[6]&15|64;b[8]=b[8]&63|128;var s="",i,h="0123456789abcdef";for(i=0;i<16;i++)s+=h[b[i]>>>4]+h[b[i]&15];return s.slice(0,8)+"-"+s.slice(8,12)+"-"+s.slice(12,16)+"-"+s.slice(16,20)+"-"+s.slice(20)}
function j(){var b=new Uint8Array(16);(w.crypto||w.msCrypto).getRandomValues(b);var s="",i;for(i=0;i<16;i++)s+=String.fromCharCode(b[i]);return w.btoa(s).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"")}
function gj(){var v=rc(JC);if(v)return v;v=j();wc(JC,v,60*60*6);return v}
function gv(){var v=rc(VC);if(v)return v;v=j();wc(VC,v,60*60*24*365);return v}
function url(){return H+"/"+E}
function ctx(){var c={},l=w.location&&w.location.href,r=d.referrer,ua=n.userAgent,lo=n.language;if(l)c.url=l;if(r)c.referrer=r;if(ua)c.user_agent=ua;if(lo)c.locale=lo;for(var k in c)return c;return undefined}
function send(body,soft){var u=url();var s=JSON.stringify(body);if(soft&&n.sendBeacon){try{if(n.sendBeacon(u,new Blob([s],{type:"application/json"})))return}catch(e){}}try{w.fetch(u,{method:"POST",headers:{"content-type":"application/json"},body:s,credentials:"include",keepalive:!!soft}).catch(function(){})}catch(e){}}
function emit(name,props,id){if(NS.indexOf(name)<0)return "";var eid=id||u();var ev={event_id:eid,journey_id:gj(),visitor_id:gv(),tenant_id:T,ts:new Date().toISOString(),name:name,props:props||{}};var c=ctx();if(c)ev.context=c;var soft=US.indexOf(name)>=0;send({events:[ev]},soft);return eid}
w.__tf={t:emit};
function pv(){emit("page_view",{path:(w.location&&w.location.pathname)||"/"})}
if(d.readyState==="loading"){d.addEventListener("DOMContentLoaded",pv,{once:true})}else{pv()}
var hs=w.history;
if(hs&&hs.pushState){var op=hs.pushState;hs.pushState=function(){var r=op.apply(this,arguments);pv();return r};w.addEventListener("popstate",pv)}
})(window,document,navigator);
`;
