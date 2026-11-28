import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bookRentalTx,
  cancelRentalBookingTx,
  convertRentalToBuyTx,
  createTxRequestId,
  moveOutRentalTx,
  releaseLegacyPlotTx,
  SalesTxError,
  signRentalContractTx,
  translateSalesTxError,
} from '../rentalTxClient';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  broadcast: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: any[]) => mocks.rpc(...args),
  },
}));

vi.mock('../salesSyncBroadcast', () => ({
  broadcastSalesSync: (...args: any[]) => mocks.broadcast(...args),
}));

describe('rentalTxClient service layer (requestId, payloads, permissions, error translation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('createTxRequestId', () => {
    it('uses crypto.randomUUID when available', () => {
      vi.stubGlobal('crypto', { randomUUID: () => '11111111-2222-4333-8444-555555555555' });
      expect(createTxRequestId()).toBe('11111111-2222-4333-8444-555555555555');
    });

    it('falls back to RFC-4122 v4 via crypto.getRandomValues when randomUUID is absent', () => {
      vi.stubGlobal('crypto', {
        getRandomValues: (bytes: Uint8Array) => {
          bytes.fill(0xff);
          return bytes;
        },
      });
      expect(createTxRequestId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    });

    it('fails closed with SALES_TX_INVALID_INPUT when Web Crypto is unavailable', () => {
      vi.stubGlobal('crypto', {});
      expect(() => createTxRequestId()).toThrow(SalesTxError);
      try {
        createTxRequestId();
      } catch (err) {
        expect((err as SalesTxError).code).toBe('SALES_TX_INVALID_INPUT');
      }
    });
  });

  describe('translateSalesTxError', () => {
    it.each([
      [{ message: 'SALES_TX_CANNOT_CANCEL_ACTIVE_RENTAL' }, 'SALES_TX_CANNOT_CANCEL_ACTIVE_RENTAL', { isStaleState: true }],
      [{ message: 'SALES_TX_ALREADY_CANCELLED' }, 'SALES_TX_ALREADY_CANCELLED', { isStaleState: true, isAlreadyCancelled: true }],
      [{ message: 'SALES_TX_STALE_STATE' }, 'SALES_TX_STALE_STATE', { isStaleState: true }],
      [{ message: 'SALES_TX_PLOT_HELD_BY_OTHER' }, 'SALES_TX_PLOT_HELD_BY_OTHER', {}],
      [{ code: '23505', message: 'duplicate key value' }, 'SALES_TX_PLOT_UNAVAILABLE', {}],
      [{ message: 'SALES_TX_IDEMPOTENCY_CONFLICT' }, 'SALES_TX_IDEMPOTENCY_CONFLICT', {}],
      [{ message: 'SALES_TX_AUTH_REQUIRED' }, 'SALES_TX_AUTH_REQUIRED', {}],
      [{ message: 'EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED' }, 'SALES_TX_FORBIDDEN', {}],
      [{ code: '42501', message: 'permission denied' }, 'SALES_TX_FORBIDDEN', {}],
      [{ message: 'SALES_TX_PROJECT_MISMATCH' }, 'SALES_TX_PROJECT_MISMATCH', {}],
      [{ message: 'SALES_TX_PLOT_AMBIGUOUS' }, 'SALES_TX_PLOT_AMBIGUOUS', {}],
      [{ message: 'SALES_TX_PLOT_NOT_FOUND' }, 'SALES_TX_PLOT_NOT_FOUND', {}],
      [{ message: 'SALES_TX_LEAD_NOT_FOUND' }, 'SALES_TX_LEAD_NOT_FOUND', { isStaleState: true }],
      [{ message: 'SALES_TX_CONTRACT_NOT_FOUND' }, 'SALES_TX_CONTRACT_NOT_FOUND', { isStaleState: true }],
      [{ message: 'SALES_TX_CONFLICT' }, 'SALES_TX_CONFLICT', { isStaleState: true }],
      [{ message: 'SALES_TX_CANCEL_REASON_REQUIRED' }, 'SALES_TX_INVALID_INPUT', {}],
      [{ code: 'PGRST202', message: 'Could not find the function' }, 'SALES_TX_RPC_NOT_INSTALLED', {}],
      [{ message: 'network timeout 504' }, 'SALES_TX_UNKNOWN', { isRetryable: true }],
    ])('translates %o to code %s', (rawError, expectedCode, expectedFlags) => {
      const translated = translateSalesTxError(rawError);
      expect(translated).toBeInstanceOf(SalesTxError);
      expect(translated.code).toBe(expectedCode);
      for (const [k, v] of Object.entries(expectedFlags)) {
        expect((translated as any)[k]).toBe(v);
      }
    });
  });

  describe('transactional RPC payloads, role gates, and sync broadcast', () => {
    it('blocks read-only Owner and Foreman roles before calling RPC', async () => {
      await expect(
        bookRentalTx({
          requestId: 'req-ro-1',
          actorRole: 'Owner',
          projectName: 'ไอลิน6',
          plotId: 'P-1',
          programType: 'program_a',
          tenantName: 'ลูกค้า',
          monthlyRent: 15000,
          securityDeposit: 30000,
          bookingAmount: 5000,
        })
      ).rejects.toMatchObject({ code: 'SALES_TX_FORBIDDEN' });

      await expect(
        releaseLegacyPlotTx({
          requestId: 'req-ro-2',
          actorRole: 'Sales',
          projectName: 'ไอลิน6',
          plotId: 'P-1',
          expectedHasCustomer: true,
          expectedSaleStatus: 'Rented',
          reason: 'legacy release',
        })
      ).rejects.toMatchObject({ code: 'SALES_TX_FORBIDDEN' });

      expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it('sends trimmed payloads and exact requestId across all 6 RPC commands and broadcasts sync', async () => {
      mocks.rpc
        .mockResolvedValueOnce({ data: { command: 'rental_book', leadId: 'l1', contractId: 'c1', plotId: 'P-1', projectName: 'ไอลิน6', rentalStatus: 'PendingContract' }, error: null })
        .mockResolvedValueOnce({ data: { command: 'rental_sign_contract', leadId: 'l1', contractId: 'c1', plotId: 'P-1', projectName: 'ไอลิน6', rentalStatus: 'Active' }, error: null })
        .mockResolvedValueOnce({ data: { command: 'rental_cancel_booking', leadId: 'l2', plotId: 'P-2', plotReleased: true, rentalStatus: 'Cancelled' }, error: null })
        .mockResolvedValueOnce({ data: { command: 'rental_move_out', contractId: 'c1', leadId: 'l1', plotId: 'P-1', depositRefunded: 28000, plotReleased: true, rentalStatus: 'MovedOut' }, error: null })
        .mockResolvedValueOnce({ data: { command: 'rental_convert_to_buy', contractId: 'c1', leadId: 'l1', saleId: 's1', plotId: 'P-1', finalPurchasePrice: 2850000, appliedBookingCredit: 15000, rentalStatus: 'ConvertedToBuy' }, error: null })
        .mockResolvedValueOnce({ data: { command: 'legacy_plot_release', plotId: 'P-9', projectName: 'ไอลิน6', previousHasCustomer: true, plotReleased: true, alreadyVacant: false }, error: null });

      await bookRentalTx({
        requestId: 'req-1',
        actorRole: 'Sales',
        projectName: 'ไอลิน6',
        plotId: 'P-1',
        programType: 'program_b',
        tenantName: '  คุณเอ  ',
        tenantPhone: ' 0811111111 ',
        agentName: ' Sales A ',
        notes: ' จองแปลง ',
        monthlyRent: 15000,
        securityDeposit: 30000,
        savingsPerMonth: 5000,
        basePrice: 2990000,
        bookingAmount: 10000,
      });
      expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'sales_tx_book_rental', {
        p_request_id: 'req-1',
        p_payload: expect.objectContaining({
          projectName: 'ไอลิน6',
          plotId: 'P-1',
          tenantName: 'คุณเอ',
          tenantPhone: '0811111111',
          agentName: 'Sales A',
          notes: 'จองแปลง',
        }),
      });

      await signRentalContractTx({
        requestId: 'req-2',
        actorRole: 'Sales',
        projectName: 'ไอลิน6',
        plotId: 'P-1',
        programType: 'program_b',
        tenantName: ' คุณเอ ',
        leadId: 'l1',
        contractId: 'c1',
        monthlyRent: 15000,
        securityDeposit: 30000,
        advanceRent: 15000,
        startDate: '2026-12-01',
        durationMonths: 12,
      });
      expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'sales_tx_sign_rental_contract', {
        p_request_id: 'req-2',
        p_payload: expect.objectContaining({ leadId: 'l1', contractId: 'c1', startDate: '2026-12-01', durationMonths: 12 }),
      });

      await cancelRentalBookingTx({
        requestId: 'req-3',
        actorRole: 'Sales',
        leadId: 'l2',
        reason: '  เปลี่ยนใจไม่เช่า  ',
      });
      expect(mocks.rpc).toHaveBeenNthCalledWith(3, 'sales_tx_cancel_rental_booking', {
        p_request_id: 'req-3',
        p_payload: expect.objectContaining({ leadId: 'l2', reason: 'เปลี่ยนใจไม่เช่า' }),
      });

      await moveOutRentalTx({
        requestId: 'req-4',
        actorRole: 'Sales',
        contractId: 'c1',
        leadId: 'l1',
        moveOutDate: '2027-01-01',
        utilityDeduction: 2000,
        notes: ' คืนกุญแจ ',
      });
      expect(mocks.rpc).toHaveBeenNthCalledWith(4, 'sales_tx_move_out_rental', {
        p_request_id: 'req-4',
        p_payload: expect.objectContaining({ contractId: 'c1', utilityDeduction: 2000, notes: 'คืนกุญแจ' }),
      });

      await convertRentalToBuyTx({
        requestId: 'req-5',
        actorRole: 'Sales',
        contractId: 'c1',
        leadId: 'l1',
        purchaseDate: '2026-12-15',
        finalPurchasePrice: 2850000,
        appliedBookingCredit: 15000,
        closingAgent: ' Sales A ',
      });
      expect(mocks.rpc).toHaveBeenNthCalledWith(5, 'sales_tx_convert_rental_to_buy', {
        p_request_id: 'req-5',
        p_payload: expect.objectContaining({ contractId: 'c1', finalPurchasePrice: 2850000, appliedBookingCredit: 15000, closingAgent: 'Sales A' }),
      });

      await releaseLegacyPlotTx({
        requestId: 'req-6',
        actorRole: 'Admin',
        projectName: 'ไอลิน6',
        plotId: 'P-9',
        expectedHasCustomer: true,
        expectedSaleStatus: 'Rented',
        reason: '  verified ended lease  ',
      });
      expect(mocks.rpc).toHaveBeenNthCalledWith(6, 'sales_tx_release_legacy_plot', {
        p_request_id: 'req-6',
        p_payload: expect.objectContaining({ plotId: 'P-9', reason: 'verified ended lease' }),
      });

      expect(mocks.broadcast).toHaveBeenCalledTimes(6);
    });

    it('rejects empty/whitespace cancellation reason before calling RPC', async () => {
      await expect(
        cancelRentalBookingTx({
          requestId: 'req-blank',
          actorRole: 'Sales',
          leadId: 'l2',
          reason: '   \n\t ',
        })
      ).rejects.toMatchObject({ code: 'SALES_TX_INVALID_INPUT' });
      expect(mocks.rpc).not.toHaveBeenCalled();
    });
  });
});
