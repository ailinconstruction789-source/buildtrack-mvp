-- ==============================================================================
-- 🚀 BUILDTRACK: SYNC SALES TO PLOT CUSTOMER STATUS
-- ==============================================================================

-- 1. สร้างฟังก์ชันสำหรับการซิงค์ข้อมูล (Trigger Function)
CREATE OR REPLACE FUNCTION sync_plot_customer_status()
RETURNS TRIGGER AS $$
DECLARE
    active_status VARCHAR;
    target_plot_id VARCHAR;
BEGIN
    -- กรณีมีการเพิ่ม หรือแก้ไข
    IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.plot_id IS NOT NULL THEN
        target_plot_id := NEW.plot_id;
        
        -- ค้นหาสถานะสูงสุดของแปลงนี้ โดยข้ามรายการที่ลูกค้ายกเลิก (Cancelled)
        SELECT contract_status INTO active_status
        FROM public.sales 
        WHERE plot_id = target_plot_id AND contract_status != 'Cancelled'
        ORDER BY 
            CASE contract_status 
                WHEN 'Transferred' THEN 1 
                WHEN 'Contracted' THEN 2 
                WHEN 'Reserved' THEN 3 
                ELSE 4 
            END
        LIMIT 1;

        IF active_status IS NOT NULL THEN
            UPDATE public.plots 
            SET has_customer = TRUE,
                -- ถ้าโอนแล้ว ให้ปรับ sale_status เป็น transferred ด้วย, ไม่งั้นปล่อยให้หน้างานจัดการต่อ
                sale_status = CASE WHEN active_status = 'Transferred' THEN 'transferred' ELSE sale_status END
            WHERE id = target_plot_id;
        ELSE
            UPDATE public.plots SET has_customer = FALSE WHERE id = target_plot_id;
        END IF;
    END IF;

    -- กรณีมีการย้ายแปลง (เปลี่ยน plot_id) ไปแปลงใหม่ ต้องเคลียร์แปลงเก่าด้วย
    IF TG_OP = 'UPDATE' AND OLD.plot_id IS NOT NULL AND OLD.plot_id != NEW.plot_id THEN
        target_plot_id := OLD.plot_id;
        
        SELECT contract_status INTO active_status
        FROM public.sales 
        WHERE plot_id = target_plot_id AND contract_status != 'Cancelled'
        ORDER BY 
            CASE contract_status 
                WHEN 'Transferred' THEN 1 
                WHEN 'Contracted' THEN 2 
                WHEN 'Reserved' THEN 3 
                ELSE 4 
            END
        LIMIT 1;

        IF active_status IS NOT NULL THEN
            UPDATE public.plots 
            SET has_customer = TRUE,
                sale_status = CASE WHEN active_status = 'Transferred' THEN 'transferred' ELSE sale_status END
            WHERE id = target_plot_id;
        ELSE
            -- ถ้าไม่มีเซลส์คนอื่นผูกกับแปลงเก่านี้แล้ว ให้รีเซ็ตสถานะลูกค้า
            UPDATE public.plots SET has_customer = FALSE WHERE id = target_plot_id;
        END IF;
    END IF;

    -- กรณีมีการลบรายการขาย
    IF TG_OP = 'DELETE' AND OLD.plot_id IS NOT NULL THEN
        target_plot_id := OLD.plot_id;
        
        SELECT contract_status INTO active_status
        FROM public.sales 
        WHERE plot_id = target_plot_id AND contract_status != 'Cancelled'
        ORDER BY 
            CASE contract_status 
                WHEN 'Transferred' THEN 1 
                WHEN 'Contracted' THEN 2 
                WHEN 'Reserved' THEN 3 
                ELSE 4 
            END
        LIMIT 1;

        IF active_status IS NOT NULL THEN
            UPDATE public.plots 
            SET has_customer = TRUE,
                sale_status = CASE WHEN active_status = 'Transferred' THEN 'transferred' ELSE sale_status END
            WHERE id = target_plot_id;
        ELSE
            UPDATE public.plots SET has_customer = FALSE WHERE id = target_plot_id;
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. สร้าง Trigger เพื่อผูกฟังก์ชันนี้เข้ากับการอัปเดตตาราง sales
DROP TRIGGER IF EXISTS trigger_sync_plot_customer_status ON public.sales;
CREATE TRIGGER trigger_sync_plot_customer_status
AFTER INSERT OR UPDATE OF plot_id, contract_status OR DELETE ON public.sales
FOR EACH ROW EXECUTE FUNCTION sync_plot_customer_status();

-- 3. อัปเดตข้อมูลที่มีอยู่แล้วย้อนหลัง (Retroactive Update)
UPDATE public.plots p
SET has_customer = TRUE
WHERE EXISTS (
    SELECT 1 FROM public.sales s 
    WHERE s.plot_id = p.id AND s.contract_status != 'Cancelled'
);

-- ปรับให้ตัวที่ถูกยกเลิกไม่มีลูกค้า (เฉพาะในกรณีที่ไม่มีข้อมูลการขายอันอื่น)
UPDATE public.plots p
SET has_customer = FALSE
WHERE p.has_customer = TRUE 
AND NOT EXISTS (
    SELECT 1 FROM public.sales s 
    WHERE s.plot_id = p.id AND s.contract_status != 'Cancelled'
);
