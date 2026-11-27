import Papa from 'papaparse';

export const categories = {
  sales: 'Product sales', shipping: 'Shipping & gift wrap', refunds: 'Refunds',
  referral: 'Referral & selling fees', fba: 'FBA fulfillment fees', storage: 'Storage fees',
  ads: 'Advertising', promos: 'Promotions', reserves: 'Reserves', tax: 'Tax collected',
  withheld: 'Marketplace tax withheld', reimbursements: 'Reimbursements',
  adjustments: 'Reviewed adjustments', other: 'Needs classification', clearing: 'Amazon clearing',
} as const;
export type Category = keyof typeof categories;
export type Format = 'dot' | 'comma';
export type Row = { id: number; settlement: string; date: string; currency: string; market: string; transaction: string; type: string; description: string; cents: number; category: Category; key: string };
export type Settlement = { id: string; start: string; end: string; depositDate: string; currency: string; expected: number; rows: Row[] };
export type Report = { settlements: Settlement[]; rows: Row[]; warnings: string[] };
export type Mapping = Record<Category, { xero: string; qbo: string }>;
export type Options = { split: boolean; baseCurrency: string; rates: Record<string, string>; overrides: Record<string, Category>; mapping: Mapping; taxName: string };
export type JournalLine = { category: Category; debit: number; credit: number; sourceCents: number; xero: string; qbo: string };
export type Journal = { id: string; date: string; currency: string; sourceCurrency: string; rate: number; lines: JournalLine[]; settlement: string; month: string };
export const currencies = ['USD', 'GBP', 'EUR', 'CAD', 'AUD'];

export function defaultMapping(): Mapping {
  const codes: Record<Category, string> = { sales:'200', shipping:'201', refunds:'205', referral:'400', fba:'401', storage:'402', ads:'403', promos:'206', reserves:'121', tax:'820', withheld:'820', reimbursements:'210', adjustments:'490', other:'999', clearing:'120' };
  return Object.fromEntries(Object.entries(categories).map(([key,label])=>[key,{xero:codes[key as Category],qbo:label === 'Reserves' ? 'Amazon reserves' : label}])) as Mapping;
}

export function parseMoney(value: string, format: Format): number {
  const clean = value.trim().replace(/[\u00a0\u202f ]/g,'');
  const pattern = format === 'dot' ? /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/ : /^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/;
  if (!pattern.test(clean)) throw new Error(`Invalid ${format === 'dot' ? 'decimal-point' : 'decimal-comma'} amount “${value}”. Check number format.`);
  const normalized = format === 'dot' ? clean.replace(/,/g,'') : clean.replace(/\./g,'').replace(',','.');
  const negative = normalized.startsWith('-');
  const [whole, fractional = ''] = normalized.replace('-','').split('.');
  const cents = (Number(whole)*100 + Number(fractional.padEnd(2,'0'))) * (negative ? -1 : 1);
  if (!Number.isSafeInteger(cents) || Math.abs(cents) > 1e12) throw new Error('Amount exceeds the supported limit.');
  return cents;
}

export function parseDate(value: string, order: 'MDY' | 'DMY'): string {
  let y: number,m: number,d: number;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[ T])/);
  const local = value.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:$|[ T])/);
  if (iso) [,y,m,d] = iso.map(Number);
  else if(local) { y = +local[3]; m = +(order==='MDY'?local[1]:local[2]); d = +(order==='MDY'?local[2]:local[1]); }
  else throw new Error(`Unrecognized date “${value}”. Use ISO or select the correct day/month order.`);
  const date = new Date(Date.UTC(y,m-1,d));
  if(date.getUTCFullYear()!==y || date.getUTCMonth()!==m-1 || date.getUTCDate()!==d || y<2000 || y>2100) throw new Error(`Invalid date “${value}”.`);
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

export function classify(transaction: string, type: string, description: string): Category {
  const text = `${transaction} ${type} ${description}`.toLowerCase();
  const desc = description.toLowerCase();
  if (/marketplacefacilitator|marketplace.*(?:withheld|withholding)|taxwithheld|tax withheld/.test(text)) return 'withheld';
  if (/tax/.test(text)) return 'tax';
  if (/reserve/.test(text)) return 'reserves';
  if (/storage|longterm|agedinventory/.test(text)) return 'storage';
  if (/advertis|costofadvertising|productads|sponsored/.test(text)) return 'ads';
  if (/reimbursement|reversalreimbursement/.test(text)) return 'reimbursements';
  if (/promotion|promotional|coupon|lightningdeal/.test(text)) return 'promos';
  if (/commission|referral|refundcommission|subscription|variableclosing|fixedclosing|sellingfee|digitalservicesfee/.test(text)) return 'referral';
  if (/fba|fulfillment|fulfilment|pick.?pack|weight.?handling|removal|disposal/.test(text)) return 'fba';
  if (/refund|chargeback/.test(transaction.toLowerCase())) return 'refunds';
  if (/shipping|giftwrap|gift.?wrap/.test(desc)) return 'shipping';
  if (/^(principal|productcharges|product charges)$/.test(desc) && /order|shipment/.test(transaction.toLowerCase())) return 'sales';
  return 'other';
}

export function parseReport(input: string, format: Format = 'dot', dateOrder: 'MDY' | 'DMY' = 'MDY'): Report {
  if(input.length > 20*1024*1024) throw new Error('Please use a report smaller than 20 MB.');
  const result = Papa.parse<Record<string,string>>(input.replace(/^\uFEFF/,''), {header:true, delimiter:'\t',skipEmptyLines:'greedy', transformHeader:h=>h.trim().toLowerCase()});
  if (result.errors.length) throw new Error(`Report could not be read: ${result.errors[0].message}`);
  const fields = result.meta.fields || [];
  for(const field of ['settlement-id','amount-type','amount-description','amount','currency','total-amount','settlement-end-date']) if(!fields.includes(field)) throw new Error(`Missing “${field}” column. Download the tab-delimited Flat File V2 report, not the date-range transaction CSV.`);
  if(result.data.length > 100000) throw new Error('Please split reports larger than 100,000 rows.');
  const metadata = new Map<string,Record<string,string>>();
  let current = '';
  const raw = result.data.map((r,i)=>{
    const id = r['settlement-id']?.trim() || current;
    if(!id) throw new Error(`Row ${i+2}: missing settlement ID.`);
    current = id;
    const meta = metadata.get(id) || {};
    for(const key of ['currency','total-amount','settlement-start-date','settlement-end-date','deposit-date']) {
      const val = r[key]?.trim();
      if(val) {
        if(meta[key] && meta[key]!==val) throw new Error(`Settlement ${id} has conflicting ${key} values. Split mixed-currency settlements into separate files.`);
        meta[key] = val;
      }
    }
    metadata.set(id,meta);
    return {r,id,index:i+2};
  });
  const warnings = new Set<string>();
  const rows: Row[] = [];
  const rowsBySettlement = new Map<string,Row[]>();
  for(const {r,id,index} of raw) {
    if(!r.amount?.trim()) {
      if(r['transaction-type']?.trim() || r['amount-type']?.trim() || r['amount-description']?.trim()) throw new Error(`Row ${index}: transaction is missing its amount.`);
      continue;
    }
    const meta = metadata.get(id)!;
    let date = r['posted-date']?.trim() || r['posted-date-time']?.trim();
    if(!date) {date=meta['settlement-end-date'];warnings.add(`Settlement ${id}: undated amounts use the settlement end date. Review reserves and adjustments.`);}
    try {
      const cents=parseMoney(r.amount,format);
      const transaction=r['transaction-type']||'',type=r['amount-type']||'',description=r['amount-description']||'';
      const row:Row={id:index,settlement:id,date:parseDate(date||'',dateOrder),currency:meta.currency,market:r['marketplace-name']||'',transaction,type,description,cents,category:classify(transaction,type,description),key:JSON.stringify([transaction,type,description])};
      rows.push(row);
      if(!rowsBySettlement.has(id)) rowsBySettlement.set(id,[]);
      rowsBySettlement.get(id)!.push(row);
    } catch(error) {throw new Error(`Row ${index}: ${(error as Error).message}`);}
  }
  if(!rows.length) throw new Error('This report contains no transaction amounts.');
  const settlements: Settlement[]=[];
  for(const [id,meta] of metadata) {
    if(!currencies.includes(meta.currency)) throw new Error(`Settlement ${id}: missing or unsupported currency. Supported: ${currencies.join(', ')}.`);
    if(meta['total-amount']===undefined) throw new Error(`Settlement ${id}: missing total-amount deposit. Reconciliation requires the settlement summary row.`);
    const end=parseDate(meta['settlement-end-date']||'',dateOrder);
    const settlementRows=rowsBySettlement.get(id)||[];
    if(!settlementRows.length) throw new Error(`Settlement ${id} contains a summary but no transaction amounts.`);
    const start=meta['settlement-start-date']?parseDate(meta['settlement-start-date'],dateOrder):'';
    if(start && start>end) throw new Error(`Settlement ${id}: start date is after end date.`);
    if(settlementRows.some(r=>r.date>end || (start && r.date<start))) throw new Error(`Settlement ${id}: a posted date is outside its settlement period. Check the slash-date order and source report.`);
    if(settlementRows.reduce((sum,r)=>sum+Math.abs(r.cents),0)>1e13) throw new Error('Batch amounts exceed the supported precision limit.');
    settlements.push({id,start,end,depositDate:meta['deposit-date']?parseDate(meta['deposit-date'],dateOrder):end,currency:meta.currency,expected:parseMoney(meta['total-amount'],format),rows:settlementRows});
  }
  warnings.add('Tax amounts are carried through, not calculated. These are No Tax / out-of-scope journals, not VAT or sales-tax returns.');
  return {settlements,rows,warnings:[...warnings]};
}

export const effectiveCategory = (r: Row, overrides: Options['overrides']): Category => overrides[r.key] || r.category;
export const settlementNet = (s: Settlement) => s.rows.reduce((sum,r)=>sum+r.cents,0);
export const difference = (s: Settlement) => settlementNet(s)-s.expected;
export function buildJournals(report: Report, options: Options): Journal[] {
  const journals: Journal[]=[];
  for(const s of report.settlements) {
    if(difference(s)!==0) throw new Error(`Settlement ${s.id} differs from its reported deposit. Resolve before exporting.`);
    const rate = s.currency===options.baseCurrency ? 1 : Number(options.rates[s.currency]);
    if(!Number.isFinite(rate)||rate<=0||rate>10000) throw new Error(`Enter a valid home-currency exchange rate for ${s.currency}.`);
    const buckets = new Map<string,Row[]>();
    for(const row of s.rows) {
      const key=options.split?row.date.slice(0,7):s.end.slice(0,7);
      if(!buckets.has(key))buckets.set(key,[]);
      buckets.get(key)!.push(row);
    }
    for(const [month,rows] of [...buckets].sort(([a],[b])=>a.localeCompare(b))) {
      const totals=new Map<Category,number>();
      for(const r of rows) {
        const c=effectiveCategory(r,options.overrides);
        if(c==='other') throw new Error('Classify every unknown amount before exporting.');
        totals.set(c,(totals.get(c)||0)+r.cents);
      }
      const lines: JournalLine[]=[];
      for(const [category,cents] of totals) {
        if(!cents)continue;
        const signed=-Math.sign(cents)*Math.round(Math.abs(cents)*rate);
        if(signed===0)continue;
        lines.push({category,debit:Math.max(0,signed),credit:Math.max(0,-signed),sourceCents:cents,...options.mapping[category]});
      }
      const net=lines.reduce((sum,l)=>sum+l.credit-l.debit,0);
      if(net)lines.push({category:'clearing',debit:Math.max(0,net),credit:Math.max(0,-net),sourceCents:rows.reduce((sum,r)=>sum+r.cents,0),...options.mapping.clearing});
      // Clearing uses the sum of rounded category lines; no unexplained balancing account.
      const endOfMonth=new Date(Date.UTC(+month.slice(0,4),+month.slice(5,7),0)).toISOString().slice(0,10);
      const date=options.split && month<s.end.slice(0,7)?endOfMonth:s.end;
      journals.push({id:`AMZ-${s.id}-${month}`,date,currency:options.baseCurrency,sourceCurrency:s.currency,rate,lines,settlement:s.id,month});
    }
  }
  return journals;
}

export function csv(data: (string|number)[][]): string {
  // Prevent formula execution when a merchant-controlled description is opened in a spreadsheet.
  return '\uFEFF'+Papa.unparse(data.map(row=>row.map(v=>typeof v==='string' && /^[\s]*[=+@-]/.test(v)?`'${v}`:v)),{newline:'\r\n'});
}
const amount=(n:number)=>(n/100).toFixed(2);
export function exportJournals(journals: Journal[],target:'xero'|'qbo', taxName='No Tax'): string {
  if(!journals.length)throw new Error('No journals to export.');
  if(target==='xero' && journals.reduce((n,j)=>n+j.lines.length,0)>300) throw new Error('Xero supports 300 lines per import. Export fewer settlements.');
  const data:(string|number)[][]=[target==='xero'?['Narration','Date','Description','AccountCode','TaxRate','Amount','TrackingName1','TrackingOption1','TrackingName2','TrackingOption2']:['Journal No.','Journal Date','Account Name','Journal/Description','Debits','Credits']];
  for(const j of journals) {
    if(j.lines.reduce((n,l)=>n+l.debit-l.credit,0)!==0) throw new Error('Journal is not balanced.');
    j.lines.forEach((line,i)=>{
      if(!line[target].trim())throw new Error(`Add the ${target==='xero'?'account code':'account name'} for ${categories[line.category]}.`);
      const narration=`${j.id} | ${j.sourceCurrency} to ${j.currency} @ ${j.rate}`;
      const [y,m,d]=j.date.split('-');
      if(target==='xero') {
        if(!taxName.trim()) throw new Error('Enter the exact No Tax / out-of-scope tax-rate name from Xero.');
        // Narration/Date only on first row: subsequent blank rows belong to that journal.
        data.push([i===0?narration:'',i===0?`${d}/${m}/${y}`:'',categories[line.category],line.xero,taxName, (line.debit-line.credit)/100,'','','','']);
      } else data.push([j.id,`${m}/${d}/${y}`,line.qbo,`${categories[line.category]} | ${narration}`,line.debit?amount(line.debit):'',line.credit?amount(line.credit):'']);
    });
  }
  return csv(data);
}
export function exportAudit(report:Report,overrides:Options['overrides']):string {
  return csv([['Source row','Settlement','Date','Currency','Marketplace','Transaction','Amount type','Amount description','Category','Amount'],...report.rows.map(r=>[r.id,r.settlement,r.date,r.currency,r.market,r.transaction,r.type,r.description,categories[effectiveCategory(r,overrides)],r.cents/100])]);
}
