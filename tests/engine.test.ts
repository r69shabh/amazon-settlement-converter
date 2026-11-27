import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { buildJournals, classify, csv, defaultMapping, difference, exportAudit, exportJournals, parseDate, parseMoney, parseReport } from '../src/engine.ts';
import type { Options } from '../src/engine.ts';
import { fallbackPlans, validatePurchase } from '../src/license.ts';
const sample=(region='us')=>readFileSync(new URL(`../public/samples/${region}-settlement.txt`,import.meta.url),'utf8');
const options=(currency='USD'):Options=>({split:true,baseCurrency:currency,rates:{},overrides:{},mapping:defaultMapping(),taxName:'No Tax'});

test('published synthetic example downloads reproduce the documented journals',()=>{
  const report=parseReport(sample(),'dot');
  const journals=buildJournals(report,options());
  assert.deepEqual(journals.map(j=>({debits:j.lines.reduce((n,l)=>n+l.debit,0),credits:j.lines.reduce((n,l)=>n+l.credit,0)})),[
    {debits:218500,credits:218500},{debits:152400,credits:152400}
  ]);
  assert.equal(journals.reduce((n,j)=>n+j.lines.find(l=>l.category==='clearing')!.debit,0),report.settlements[0].expected);
  for(const target of ['xero','qbo'] as const)assert.equal(readFileSync(new URL(`../public/examples/us-${target}.csv`,import.meta.url),'utf8'),exportJournals(journals,target));
  assert.equal(readFileSync(new URL('../public/examples/us-audit.csv',import.meta.url),'utf8'),exportAudit(report,{}));
});

for(const [region,currency,format] of [['us','USD','dot'],['uk','GBP','dot'],['eu','EUR','comma']] as const) {
  test(`${region.toUpperCase()} sample reconciles and splits at month end`,()=>{
    const r=parseReport(sample(region),format);
    assert.equal(r.rows.length,16);assert.equal(difference(r.settlements[0]),0);
    assert.equal(r.settlements[0].expected,242200);
    const js=buildJournals(r,options(currency));
    assert.deepEqual(js.map(j=>j.date),['2026-01-31','2026-02-04']);
    assert.equal(js[0].lines.find(l=>l.category==='sales')?.credit,200000);
    assert.equal(js[0].lines.find(l=>l.category==='clearing')?.debit,140500);
    assert.equal(js[1].lines.find(l=>l.category==='clearing')?.debit,101700);
    for(const j of js)assert.equal(j.lines.reduce((n,l)=>n+l.debit-l.credit,0),0);
    const xero=Papa.parse<string[]>(exportJournals(js,'xero')).data;
    assert.deepEqual(xero[0].slice(0,6),['Narration','Date','Description','AccountCode','TaxRate','Amount']);
    const firstRows=xero.slice(1).filter(row=>row[0]);assert.equal(firstRows.length,2);
    assert.equal(firstRows[0][1],'31/01/2026');assert.equal(xero[2][0],'');assert.equal(xero[2][1],'');
    const qbo=Papa.parse<string[]>(exportJournals(js,'qbo')).data;
    assert.deepEqual(qbo[0],['Journal No.','Journal Date','Account Name','Journal/Description','Debits','Credits']);
    assert.equal(new Set(qbo.slice(1).map(row=>row[0])).size,2);
    assert.equal(qbo[1][1],'01/31/2026');
  });
}
test('explicit FX keeps currency groups separate and balances rounded category totals',()=>{
  const us=parseReport(sample());const eu=parseReport(sample('eu'),'comma');
  const batch={settlements:[...us.settlements,...eu.settlements],rows:[...us.rows,...eu.rows],warnings:[]};
  assert.throws(()=>buildJournals(batch,options()),/exchange rate for EUR/);
  const js=buildJournals(batch,{...options(),rates:{EUR:'1.072341'}});
  assert.equal(js.length,4);assert.equal(js[2].sourceCurrency,'EUR');
  assert.equal(js[2].lines.find(l=>l.category==='sales')?.credit,214468);
  for(const j of js)assert.equal(j.lines.reduce((n,l)=>n+l.debit-l.credit,0),0);
  for(const rate of ['0','-1','NaN','Infinity','10001'])assert.throws(()=>buildJournals(eu,{...options(),rates:{EUR:rate}}),/exchange rate/);
});
test('unsplit export uses settlement end date, not deposit date',()=>{
  const js=buildJournals(parseReport(sample()),{...options(),split:false});
  assert.equal(js.length,1);assert.equal(js[0].date,'2026-02-04');
  assert.equal(js[0].lines.find(l=>l.category==='clearing')?.debit,242200);
});
test('a missing source amount or penny discrepancy blocks export rather than balancing it away',()=>{
  assert.throws(()=>parseReport(sample().replace('2000.00\tAFN','\tAFN')),/missing its amount/);
  const r=parseReport(sample().replace('2422.00','2422.01'));
  assert.equal(difference(r.settlements[0]),-1);
  assert.throws(()=>buildJournals(r,options()),/differs from its reported deposit/);
});
test('new Amazon fee names need an explicit classification',()=>{
  const r=parseReport(sample().replace('StorageFee','NewUnrecognizedFee'));
  const unknown=r.rows.find(row=>row.category==='other')!;assert.ok(unknown);
  assert.throws(()=>buildJournals(r,options()),/Classify every unknown/);
  assert.equal(buildJournals(r,{...options(),overrides:{[unknown.key]:'adjustments'}}).length,2);
  assert.ok(exportAudit(r,{[unknown.key]:'adjustments'}).includes('Reviewed adjustments'));
});
test('classification preserves facilitator withholding, tax refunds, fee refunds and reimbursements',()=>{
  assert.equal(classify('Order','ItemWithheldTax','MarketplaceFacilitatorVAT-Principal'),'withheld');
  assert.equal(classify('Refund','ItemPrice','Tax'),'tax');
  assert.equal(classify('Refund','ItemFees','Commission'),'referral');
  assert.equal(classify('Adjustment','other-transaction','FBAInventoryReimbursement'),'reimbursements');
  assert.equal(classify('Reserve','other-transaction','Current Reserve Amount'),'reserves');
});
test('money uses exact cents and rejects malformed / wrong-locale values',()=>{
  assert.equal(parseMoney('1,234.56','dot'),123456);assert.equal(parseMoney('-1.234,56','comma'),-123456);
  assert.equal(parseMoney('0.29','dot'),29);assert.equal(parseMoney('1\u00a0234,56','comma'),123456);
  for(const bad of ['1.234','1,23.45','USD 10','NaN','2.567','12,34',''])assert.throws(()=>parseMoney(bad,'dot'));
  assert.throws(()=>parseReport(sample('eu'),'dot'),/amount|format/);
});
test('dates preserve the report calendar and require a chosen slash order',()=>{
  assert.equal(parseDate('2026-01-31T23:59:00-08:00','MDY'),'2026-01-31');
  assert.equal(parseDate('01/02/2026','MDY'),'2026-01-02');assert.equal(parseDate('01/02/2026','DMY'),'2026-02-01');
  assert.throws(()=>parseDate('2026-02-30','MDY'),/Invalid/);
  assert.throws(()=>parseDate('31/01/2026','MDY'),/Invalid/);
});
test('rejects transaction CSV, no total, inconsistent currency and empty reports',()=>{
  assert.throws(()=>parseReport('Date,Amount\n2026-01-01,10'),/Missing/);
  assert.throws(()=>parseReport(sample().replace('2422.00','')),/missing total-amount/);
  assert.throws(()=>parseReport(sample().replace(/\tOrder\t/,'\tOrder\t').replace('USD','JPY')),/unsupported currency/);
  const conflict=Array(24).fill('');conflict[0]='DEMO-US-2602';conflict[5]='EUR';
  assert.throws(()=>parseReport(sample()+conflict.join('\t')+'\n'),/conflicting currency/);
  assert.throws(()=>parseReport(sample().split('\n').slice(0,2).join('\n')),/no transaction/);
});
test('undated reserve amounts use end date and disclose the fallback',()=>{
  const r=parseReport(sample().replace('2026-02-04\t2026-02-04 12:00:00 UTC','\t'));
  assert.ok(r.warnings.some(w=>w.includes('undated amounts')));
});
test('CSV handles quotes, delimiters and spreadsheet formula injection without corrupting signed amounts',()=>{
  const data=Papa.parse<string[]>(csv([['=SUM(1,2)','@attack','safe "quoted", comma',-12.34]])).data;
  assert.equal(data[0][0],"'=SUM(1,2)");assert.equal(data[0][1],"'@attack");assert.equal(data[0][2],'safe "quoted", comma');assert.equal(data[0][3],'-12.34');
});
test('empty accounts and invalid Xero tax names are blocked',()=>{
  const js=buildJournals(parseReport(sample()),options());
  js[0].lines[0].xero='';assert.throws(()=>exportJournals(js,'xero'),/account code/);
  js[0].lines[0].xero='200';assert.throws(()=>exportJournals(js,'xero',''),/tax-rate name/);
  js[0].lines[0].qbo='';assert.throws(()=>exportJournals(js,'qbo'),/account name/);
});
test('large supported batches group efficiently without losing amounts',()=>{
  const source=parseReport(sample());
  const rows=Array.from({length:100000},(_,i)=>({...source.rows[0],id:i+2,cents:1}));
  const settlement={...source.settlements[0],expected:100000,rows};
  const journals=buildJournals({rows,settlements:[settlement],warnings:[]},options());
  assert.equal(journals.length,1);assert.equal(journals[0].lines.find(l=>l.category==='sales')?.credit,100000);
  assert.equal(journals[0].lines.find(l=>l.category==='clearing')?.debit,100000);
});
test('license verification rejects refunds, wrong products and ended or expired plans',()=>{
  const plan={...fallbackPlans[0],productId:'product-123'};
  const purchase={product_id:plan.productId,created_at:'2026-01-01T00:00:00Z'};
  const now=Date.parse('2026-07-01T00:00:00Z');
  assert.doesNotThrow(()=>validatePurchase(purchase,plan,now));
  assert.throws(()=>validatePurchase({...purchase,refunded:true},plan,now),/refunded/);
  assert.throws(()=>validatePurchase({...purchase,product_id:'wrong'},plan,now),/different product/);
  assert.throws(()=>validatePurchase({...purchase,created_at:'2024-01-01'},plan,now),/expired/);
  assert.throws(()=>validatePurchase({...purchase,subscription_cancelled_at:'2026-06-30'},plan,now),/no longer active/);
  assert.doesNotThrow(()=>validatePurchase({...purchase,subscription_id:'active',created_at:'2022-01-01'},plan,now));
  assert.doesNotThrow(()=>validatePurchase({...purchase,created_at:'2022-01-01'},{...plan,id:'lifetime'},now));
  assert.throws(()=>validatePurchase({...purchase,subscription_id:'sub',subscription_failed_at:'2026-01-01'},plan,now),/no longer active/);
});
