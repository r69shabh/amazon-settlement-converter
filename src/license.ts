export type Plan = { id:'seller'|'lifetime'|'bookkeeper'; name:string; price:string; period:string; productId:string; url:string };
export type Purchase = { product_id?:string; refunded?:boolean; disputed?:boolean; chargebacked?:boolean; subscription_ended_at?:string|null; subscription_cancelled_at?:string|null; subscription_failed_at?:string|null; subscription_id?:string|null; recurrence?:string|null; created_at?:string; sale_timestamp?:string };
export const fallbackPlans:Plan[] = [
  {id:'seller',name:'Seller',price:'49',period:'/ year',productId:'',url:''},
  {id:'lifetime',name:'Seller lifetime',price:'79',period:'one time',productId:'',url:''},
  {id:'bookkeeper',name:'Bookkeeper',price:'149',period:'/ year',productId:'',url:''},
];
export function validatePurchase(p:Purchase,plan:Plan,now=Date.now()):void {
  if(!plan.productId || p.product_id!==plan.productId) throw new Error('This key belongs to a different product. Select the plan you purchased.');
  if(p.refunded||p.disputed||p.chargebacked)throw new Error('This purchase has been refunded or disputed. Contact the store for help.');
  for(const key of ['subscription_ended_at','subscription_cancelled_at','subscription_failed_at'] as const) {
    if(p[key] && (!Number.isFinite(Date.parse(p[key]!)) || Date.parse(p[key]!)<=now))throw new Error('This membership is no longer active. Renew it on Gumroad.');
  }
  if(plan.id!=='lifetime' && !p.subscription_id) {
    const purchased=Date.parse(p.sale_timestamp||p.created_at||'');
    const expiry=new Date(purchased);expiry.setUTCFullYear(expiry.getUTCFullYear()+1);
    if(!Number.isFinite(purchased)||expiry.getTime()<=now)throw new Error('This annual license has expired. Renew it on Gumroad.');
  }
}
export async function verifyLicense(key:string,plan:Plan):Promise<void> {
  if(!key.trim())throw new Error('Enter the license key from your Gumroad receipt.');
  if(!plan.productId)throw new Error('Paid licenses are not available yet. Sample exports are free.');
  let response:Response;
  try {
    response=await fetch('https://api.gumroad.com/v2/licenses/verify',{method:'POST',body:new URLSearchParams({product_id:plan.productId,license_key:key.trim(),increment_uses_count:'false'}),signal:AbortSignal.timeout(15000)});
  } catch {throw new Error('Could not reach Gumroad. Check your connection and try again. Your report has not been sent.');}
  const data=await response.json().catch(()=>null);
  if(!response.ok||!data?.success||!data.purchase)throw new Error(response.status===429?'Gumroad is busy. Wait a minute, then try again.':'License not recognized. Check your key and selected plan.');
  validatePurchase(data.purchase,plan);
}
export function safeCheckout(url:string):boolean {
  try {const u=new URL(url);return u.protocol==='https:'&&(u.hostname==='gumroad.com'||u.hostname.endsWith('.gumroad.com'));}catch{return false;}
}
