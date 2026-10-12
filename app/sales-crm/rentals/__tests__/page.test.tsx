import React from 'react';
import { cleanup,render,screen } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({enabled:vi.fn(),workspace:vi.fn()}));
vi.mock('@/lib/sales/rentalCommandServer',()=>({rentalCommandsEnabled:mocks.enabled}));
vi.mock('@/components/sales/CanonicalRentalWorkspace',()=>({default:(props:unknown)=>{mocks.workspace(props);return <div>Workspace</div>;}}));
import Page from '../page';
import { rentalId } from '@/lib/sales/__tests__/rentalCommandFixtures';
beforeEach(()=>{vi.clearAllMocks();mocks.enabled.mockReturnValue(true);});afterEach(cleanup);
describe('canonical rental page gate',()=>{
 it('feature off never reads query or renders client writer',async()=>{mocks.enabled.mockReturnValue(false);const query={then:vi.fn()};render(await Page({searchParams:query as unknown as Promise<Record<string,string>>}));expect(screen.getByRole('heading',{name:'ยังไม่เปิดสัญญาเช่าส่วนกลาง'})).toBeInTheDocument();expect(query.then).not.toHaveBeenCalled();expect(mocks.workspace).not.toHaveBeenCalled();});
 it('awaits exact customer/project/contract search params',async()=>{render(await Page({searchParams:Promise.resolve({customerId:rentalId(2),projectName:'A',contractId:rentalId(1)})}));expect(mocks.workspace).toHaveBeenCalledWith({customerId:rentalId(2),projectName:'A',contractId:rentalId(1)});});
 it('permits no selected contract for starting later',async()=>{render(await Page({searchParams:Promise.resolve({customerId:rentalId(2),projectName:'A'})}));expect(mocks.workspace).toHaveBeenCalledWith({customerId:rentalId(2),projectName:'A',contractId:null});});
 it.each([{customerId:'invalid',projectName:'A'},{customerId:[rentalId(2)],projectName:'A'},{customerId:rentalId(2),projectName:'A',extra:'1'}])('rejects malformed or extra query %#',async query=>{render(await Page({searchParams:Promise.resolve(query)}));expect(screen.getByRole('heading',{name:'ลิงก์ลูกค้าหรือสัญญาไม่ถูกต้อง'})).toBeInTheDocument();expect(mocks.workspace).not.toHaveBeenCalled();});
});
