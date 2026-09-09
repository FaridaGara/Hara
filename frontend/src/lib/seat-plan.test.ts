import { describe, expect, it } from 'vitest';
import { allSeats, assignCategory, blockInputError, createBlock, emptySeatPlan, planIssues, planTickets, readSeatPlan, reusablePlan, rowLabel, saleSeats, setBlocked } from './seat-plan';
const input = { name:'Parter', rows:6, columns:10, firstRow:'A', firstSeat:1, aisle:5, direction:'ltr' as const };
function fixture() { const plan=emptySeatPlan('manual:hall');return {...plan,name:'Konsert',blocks:[createBlock(input)]}; }
describe('seat plan inventory',()=>{
  it('generates unique seats, aisle spacing, reversed numbering and alphabetic overflow',()=>{
    const b=createBlock(input); expect(new Set(b.seats.map(s=>s.id)).size).toBe(60);
    expect(b.seats[5].x-b.seats[4].x).toBe(104);expect(rowLabel(26)).toBe('AA');
    expect(createBlock({...input,direction:'rtl'}).seats.slice(0,3).map(s=>s.number)).toEqual([10,9,8]);
    expect(blockInputError({...input,rows:0})).toBeTruthy();expect(blockInputError({...input,rows:1.5})).toBeTruthy();
  });
  it('keeps blocked seats in geometry, sells 58 and restores category on reopening',()=>{
    let plan=fixture();const b=plan.blocks[0];
    plan=assignCategory(plan,{id:'standard',name:'Standart',price:'25',free:false},['A','B','C','D','E','F'].map(r=>`${b.id}:${r}`));
    const last=allSeats(plan).filter(s=>s.row==='F'&&s.number>=9).map(s=>s.id);
    plan=setBlocked(plan,last,true,'Texniki');expect(allSeats(plan)).toHaveLength(60);expect(saleSeats(plan)).toHaveLength(58);
    expect(planTickets(plan)[0].quantity).toBe('58');expect(planIssues(plan,60)).toEqual([]);
    plan=setBlocked(plan,last,false);expect(planTickets(plan)[0].quantity).toBe('60');expect(planIssues(plan,60)).toEqual([]);
  });
  it('blocks missing prices, duplicate labels, capacity overflow and reused prices',()=>{
    let plan=fixture();expect(planIssues(plan,59).join(' ')).toContain('tutumunu keçir');
    expect(planIssues(plan).join(' ')).toContain('60 yer üçün qiymət');
    plan=assignCategory(plan,{id:'free',name:'Pulsuz',price:'',free:true},plan.blocks.flatMap(b=>['A','B','C','D','E','F'].map(r=>`${b.id}:${r}`)));
    expect(planIssues(plan)).toEqual([]);expect(planIssues(reusablePlan(plan)).join(' ')).toContain('qiymət çatışmır');
    const duplicate=createBlock(input);plan.blocks.push(duplicate);expect(planIssues(plan).join(' ')).toContain('unikal');
  });
  it('preserves assignments and blocked state when resizing existing rows',()=>{
    let plan=fixture();const id=plan.blocks[0].seats[0].id;plan=setBlocked(plan,[id],true,'Səbəb');
    const next=createBlock({...input,rows:7},plan.blocks[0]);expect(next.seats[0]).toMatchObject({id,blocked:true,reason:'Səbəb'});expect(next.seats).toHaveLength(70);
  });
  it('clears category assignments when a row is deselected and rejects corrupt drafts',()=>{
    let plan=fixture();const b=plan.blocks[0],cat={id:'vip',name:'VIP',price:'40',free:false};
    plan=assignCategory(plan,cat,[`${b.id}:A`,`${b.id}:B`]);plan=assignCategory(plan,cat,[`${b.id}:A`]);
    expect(saleSeats(plan).filter(s=>s.categoryId==='vip')).toHaveLength(10);
    expect(readSeatPlan(JSON.parse(JSON.stringify(plan)))).toBeTruthy();
    expect(readSeatPlan({...plan,blocks:[{...b,scale:NaN}]})).toBeNull();expect(readSeatPlan({...plan,background:'javascript:alert(1)'})).toBeNull();
  });
});
