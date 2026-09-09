import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_EVENT_DRAFT, emptySales, type EventDraft } from '@/lib/event-draft';
import { createBlock, emptySeatPlan, saleSeats } from '@/lib/seat-plan';
import { seatPlansApi } from '@/lib/api/seat-plans';
import { SeatPlanEditor } from './seat-plan-editor';
vi.mock('@/lib/api/seat-plans',()=>({seatPlansApi:{save:vi.fn(),list:vi.fn(),get:vi.fn()}}));
const input={name:'Parter',rows:6,columns:10,firstRow:'A',firstSeat:1,aisle:5,direction:'ltr' as const};
function Harness({done=vi.fn(),withSeats=true}:{done?:(draft:EventDraft)=>void;withSeats?:boolean}) {
 const [draft,setDraft]=useState<EventDraft>(()=>({...EMPTY_EVENT_DRAFT,sales:{...emptySales(),admissionType:'seated',capacity:'100',seatPlan:{...emptySeatPlan(''),name:'Zal',background:'',blocks:withSeats?[createBlock(input)]:[]}}}));
 return <SeatPlanEditor draft={draft} updateDraft={setDraft} save={()=>true} onDone={()=>done(draft)} />;
}
beforeEach(()=>vi.clearAllMocks());
describe('seat plan editor flow',()=>{
 it('selects F9–F10, blocks them, prices 58 places and applies only after server success',async()=>{
  const user=userEvent.setup();const done=vi.fn();vi.mocked(seatPlansApi.save).mockResolvedValue({id:'saved',name:'Zal',seat_count:60,blocked_count:2});render(<Harness done={done}/>);
  await user.click(screen.getByRole('button',{name:'Yerləri seç'}));
  await user.type(screen.getByLabelText('Aralığın ilk yeri'),'F9');await user.type(screen.getByLabelText('Aralığın son yeri'),'F10');
  await user.click(screen.getByRole('button',{name:'Aralıqdakı yerləri seç'}));await user.click(screen.getByRole('button',{name:'2 yeri seç'}));
  await user.click(screen.getByRole('button',{name:'2 yeri satışa bağla'}));expect(screen.getByText('2. Düzülüş · 60 yer · 58 satış')).toBeTruthy();
  await user.click(screen.getByRole('button',{name:'Qiymət və yoxlamaya keç'}));expect((screen.getByRole('button',{name:'Planı saxla və tətbiq et'}) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole('button',{name:'Qiymət kateqoriyası əlavə et'}));await user.type(screen.getByLabelText('Kateqoriyanın adı'),'Standart');
  for(const row of ['A','B','C','D','E','F']) await user.click(screen.getByLabelText(`Parter · ${row}`,{exact:true}));
  await user.type(screen.getByLabelText('Kateqoriyanın qiyməti'),'25');await user.click(screen.getByRole('button',{name:'58 yerə tətbiq et'}));
  await user.click(screen.getByRole('button',{name:'Planı saxla və tətbiq et'}));await waitFor(()=>expect(done).toHaveBeenCalledOnce());
  const submitted=vi.mocked(seatPlansApi.save).mock.calls[0][0];expect(saleSeats(submitted)).toHaveLength(58);
 });
 it('preserves editor data and shows retryable save failure',async()=>{
  const user=userEvent.setup();vi.mocked(seatPlansApi.save).mockRejectedValue(new Error('Şəbəkə xətası'));const done=vi.fn();render(<Harness done={done}/>);
  await user.click(screen.getByRole('button',{name:'Qiymət və yoxlamaya keç'}));await user.click(screen.getByRole('button',{name:'Qiymət kateqoriyası əlavə et'}));await user.type(screen.getByLabelText('Kateqoriyanın adı'),'Pulsuz');
  for(const row of ['A','B','C','D','E','F'])await user.click(screen.getByLabelText(`Parter · ${row}`,{exact:true}));await user.click(screen.getByLabelText('Pulsuz',{exact:true}));await user.click(screen.getByRole('button',{name:'60 yerə tətbiq et'}));await user.click(screen.getByRole('button',{name:'Planı saxla və tətbiq et'}));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent','Şəbəkə xətası');expect(done).not.toHaveBeenCalled();
 });
 it('shows the empty saved-plan state without fabricating venue plans',async()=>{
  vi.mocked(seatPlansApi.list).mockResolvedValue([]);const user=userEvent.setup();render(<Harness withSeats={false}/>);
  await user.click(screen.getByRole('button',{name:/Saxlanmış planlarım/}));expect(await screen.findByText('Hələ saxlanmış plan yoxdur')).toBeTruthy();
 });
});
