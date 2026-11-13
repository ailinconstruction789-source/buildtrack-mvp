-- ==============================================================================
-- 🏗️ BUILDTRACK: 70 QC FORM TEMPLATES & ITEMS MIGRATION (FROM LEGACY PDF)
-- Source: D:\qc\บ้าน 2 ชั้น\QC บ้าน 2 ชั้น V2.pdf
-- Covers both 1-Story and 2-Story houses (70 tasks, 333 items, 32 numeric checks)
-- ==============================================================================

DO $$
DECLARE
    v_template_id UUID;
BEGIN

    -- Form #1: QC-STR-001 - งานโครงสร้างฐานราก
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-STR-001', 'งานโครงสร้างฐานราก', 'แบบฟอร์มตรวจสอบ QC งานโครงสร้างฐานราก (ลำดับที่ 1 จากมาตรฐานโครงการ)', 'งานโครงสร้าง', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ระยะ offset แนวที่ดิน, ระยะศูนย์กลางเสาตอม่อ ± 2.00 ซม.',
        '', 'number', true, false, true,
        false, 'ซม.', 0.0, -2.0, 2.0, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'ฐานรากได้ฉาก ได้แนว ไม่บิดไม่เบี้ยว',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'ฐานรากได้ขนาดและความหนาตามแบบ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'ห้ามใช้ดินเข้าแบบในการเทคอนกรีต',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #2: QC-STR-002 - งานโครงสร้างตอม่อ
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-STR-002', 'งานโครงสร้างตอม่อ', 'แบบฟอร์มตรวจสอบ QC งานโครงสร้างตอม่อ (ลำดับที่ 2 จากมาตรฐานโครงการ)', 'งานโครงสร้าง', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ระยะ offset แนวที่ดิน, ระยะศูนย์กลางเสาตอม่อ ± 2.00 ซม.',
        '', 'number', true, false, true,
        false, 'ซม.', 0.0, -2.0, 2.0, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'กลบดินตอม่อเรียบร้อย ปรับดินเรียบทั้งหมด',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'ระดับเทคอนกรีตตอม่อได้ระดับ ต้นที่หยุดใต้คานมีการเผื่อเหล็กไว้ 50 ซม.',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'เหล็กเสริมเสาที่ขึ้นจากตอม่อ ถูกต้องตามแบบ',
        '', 'pass_fail_na', true, true, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #3: QC-SAN-002 - งานวางถังบำบัด
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-SAN-002', 'งานวางถังบำบัด', 'แบบฟอร์มตรวจสอบ QC งานวางถังบำบัด (ลำดับที่ 3 จากมาตรฐานโครงการ)', 'งานระบบสุขาภิบาล', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ตำแหน่งของถังบำบัดและบ่อดักไขมัน ตำแหน่งและระดับถูกต้อง',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'มีการเทฐานคอนกรีต ถังบำบัดน้ำเสีย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'เช็คค่าระดับ ให้ได้ตามระบุในแบบ ± 1 ซม.',
        '', 'number', true, false, true,
        false, 'ซม.', 0.0, -1.0, 1.0, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'ขอบบ่อและฝาปิดไม่แตก ไม่บิ่น',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'ก่อต่อปากบ่อเรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #4: QC-STR-003 - งานคานชั้น 1
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-STR-003', 'งานคานชั้น 1', 'แบบฟอร์มตรวจสอบ QC งานคานชั้น 1 (ลำดับที่ 4 จากมาตรฐานโครงการ)', 'งานโครงสร้าง', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'เทลีนก่อนเทคานคอดิน',
        '', 'pass_fail_na', true, true, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'ฝากเหล็กเสริม สำหรับรัดแผ่นพื้นสำเร็จรูป (shear key) , เหล็กบันได ครบตามจำนวน',
        '', 'pass_fail_na', true, true, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'เหล็กฝากรับบันได, ฝากท่อ สำหรับเดินท่อปลวก ขนาด 1/2 นิ้ว',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'ตรวจสอบความสมบูรณ์ของคอนกรีต หลังแกะแบบหล่อ เนื้อแน่นไม่เป็นโพรง ขนาดไม่บวม เป็นแนวเส้นตรง',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'คานที่รับพื้น S1 ลดระดับไว้อย่างน้อยครึ่งหนึ่งหรือเต็มคานสำหรับชั้น 1',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #5: QC-SAN-003 - งานฝากสลีปท่อประปา ชั้น 1
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-SAN-003', 'งานฝากสลีปท่อประปา ชั้น 1', 'แบบฟอร์มตรวจสอบ QC งานฝากสลีปท่อประปา ชั้น 1 (ลำดับที่ 5 จากมาตรฐานโครงการ)', 'งานระบบสุขาภิบาล', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'เช็คค่าระดับท่อโสโครก ให้ได้ตามระบุในแบบ ค่าเคลื่อนได้ไม่เกิน -5.00 ซม.',
        '', 'number', true, false, true,
        false, 'ซม.', NULL, -10.0, -5.0, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'อุดปากท่อทั้งหมดเพื่อป้องกันไม่ให้ดินเข้า',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'ตำแหน่งระยะการวางท่อสลีป ตรงตามแบบระบุ ± 2.00 ซม.',
        '', 'number', true, false, true,
        false, 'ซม.', 0.0, -2.0, 2.0, '[]'::jsonb
    );


    -- Form #6: QC-STR-004 - งานโครงสร้างพื้น ชั้น 1
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-STR-004', 'งานโครงสร้างพื้น ชั้น 1', 'แบบฟอร์มตรวจสอบ QC งานโครงสร้างพื้น ชั้น 1 (ลำดับที่ 6 จากมาตรฐานโครงการ)', 'งานโครงสร้าง', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ระยะศูนย์กลางเสา ถึง เสา ได้ระยะตามแบบ ± 1.00 ซม.',
        '', 'number', true, false, true,
        false, 'ซม.', 0.0, -1.0, 1.0, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'หลังถอดแบบ ตรวจสอบความสมบูรณ์ ของคอนกรีต ไม่เป็นโพรง เนื้อแน่น',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'หลังเทคอนกรีตเรียบเสมอ ไม่เป็นคลื่น ไม่มีน้ำขัง เป็นแอ่ง ไม่มีรอยแตกร้าว',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'ไม่มีรอยร้าวของ คอนกรีต หลังเทเสร็จ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'กรอบพื้น ± 2.00 ซม. จากระยะตามแบบ และตีเส้นฉาก เรียบร้อย',
        '', 'number', true, false, true,
        false, 'ซม.', 0.0, -2.0, 2.0, '[]'::jsonb
    );


    -- Form #7: QC-STR-005 - งานโครงสร้างเสา ชั้น 1
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-STR-005', 'งานโครงสร้างเสา ชั้น 1', 'แบบฟอร์มตรวจสอบ QC งานโครงสร้างเสา ชั้น 1 (ลำดับที่ 7 จากมาตรฐานโครงการ)', 'งานโครงสร้าง', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ระยะศูนย์ เสา ถึง เสา ได้ระยะตามแบบ ± 1.00 ซม.',
        '', 'number', true, false, true,
        false, 'ซม.', 0.0, -1.0, 1.0, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'หลังถอดแบบ ตรวจสอบความสมบูรณ์ ของคอนกรีต ไม่เป็นโพรง เนื้อแน่น',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'เสาได้ขนาดตามแบบ± 1.00 ซม. ไม่บวม, ตรวจความมั่นคงของเสา',
        '', 'number', true, false, true,
        false, 'ซม.', 0.0, -1.0, 1.0, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'ไม่มีรอยร้าวของ คอนกรีต หลังเทเสร็จ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'ระยะดิ่งของเสาเอียงได้ ± 1.00 ซม. ความสูงของเสา ± 1.00 ซม. โดยใช้เส้นระดับในการวัด ไม่ใช่ระยะจากพื้น',
        '', 'number', true, false, true,
        false, 'ซม.', 0.0, -1.0, 1.0, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 6, 'การตรวจสอบทั่วไป', 'Q06', 'มีการเผื่อเหล็กสำหรับเพลทหลังคา ยาว 0.20 เมตร',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #8: QC-STR-006 - งานโครงสร้างพื้นซักล้าง
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-STR-006', 'งานโครงสร้างพื้นซักล้าง', 'แบบฟอร์มตรวจสอบ QC งานโครงสร้างพื้นซักล้าง (ลำดับที่ 8 จากมาตรฐานโครงการ)', 'งานโครงสร้าง', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ระยะศูนย์กลางเสา ถึง เสา ได้ระยะตามแบบ ± 1.00 ซม.',
        '', 'number', true, false, true,
        false, 'ซม.', 0.0, -1.0, 1.0, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'หลังถอดแบบ ตรวจสอบความสมบูรณ์ ของคอนกรีต ไม่เป็นโพรง เนื้อแน่น',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'หลังเทคอนกรีตเรียบเสมอ ไม่เป็นคลื่น ไม่มีน้ำขัง เป็นแอ่ง ไม่มีรอยแตกร้าว',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'ไม่มีรอยร้าวของ คอนกรีต หลังเทเสร็จ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'กรอบพื้น ± 2.00 ซม. จากระยะตามแบบ และตีเส้นฉาก เรียบร้อย',
        '', 'number', true, false, true,
        false, 'ซม.', 0.0, -2.0, 2.0, '[]'::jsonb
    );


    -- Form #9: QC-STR-007 - งานคานชั้น 2
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-STR-007', 'งานคานชั้น 2', 'แบบฟอร์มตรวจสอบ QC งานคานชั้น 2 (ลำดับที่ 9 จากมาตรฐานโครงการ) (เฉพาะบ้าน 2 ชั้น)', 'งานโครงสร้าง', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ไม้ไผ่ค้ำยันคานระยะ @ ไม่เกิน 0.40 เมตร',
        '', 'number', true, false, true,
        false, 'เมตร', NULL, 0.0, 0.4, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'ฝากเหล็กเสริม สำหรับรัดแผ่นพื้นสำเร็จรูป (shear key) , เหล็กบันได ครบตามจำนวน',
        '', 'pass_fail_na', true, true, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'ฝากเหล็กรับบันไดไว้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'ตรวจสอบความสมบูรณ์ของคอนกรีต หลังแกะแบบหล่อ เนื้อแน่นไม่เป็นโพรง ขนาดไม่บวม เป็นแนวเส้นตรง',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'หัวเสาฃั้น 1 ที่รับคานต้องไม่มีรอยแตกร้าว',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #10: QC-SAN-004 - งานฝากสลีปชั้น 2
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-SAN-004', 'งานฝากสลีปชั้น 2', 'แบบฟอร์มตรวจสอบ QC งานฝากสลีปชั้น 2 (ลำดับที่ 10 จากมาตรฐานโครงการ) (เฉพาะบ้าน 2 ชั้น)', 'งานระบบสุขาภิบาล', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'เช็คค่าระดับท่อโสโครก ให้ได้ตามระบุในแบบ ค่าเคลื่อนได้ไม่เกิน -5.00 ซม.',
        '', 'number', true, false, true,
        false, 'ซม.', NULL, -10.0, -5.0, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'อุดปากท่อทั้งหมดเพื่อป้องกันไม่ให้คอนกรีตเข้า',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'ตำแหน่งระยะการวางท่อสลีป ตรงตามแบบระบุ ± 2.00 ซม.',
        '', 'number', true, false, true,
        false, 'ซม.', 0.0, -2.0, 2.0, '[]'::jsonb
    );


    -- Form #11: QC-STR-008 - งานโครงสร้างพื้น ชั้น 2
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-STR-008', 'งานโครงสร้างพื้น ชั้น 2', 'แบบฟอร์มตรวจสอบ QC งานโครงสร้างพื้น ชั้น 2 (ลำดับที่ 11 จากมาตรฐานโครงการ) (เฉพาะบ้าน 2 ชั้น)', 'งานโครงสร้าง', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ระยะศูนย์กลางเสา ถึง เสา ได้ระยะตามแบบ ± 1.00 ซม.',
        '', 'number', true, false, true,
        false, 'ซม.', 0.0, -1.0, 1.0, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'หลังถอดแบบ ตรวจสอบความสมบูรณ์ ของคอนกรีต ไม่เป็นโพรง เนื้อแน่น',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'หลังเทคอนกรีตเรียบเสมอ ไม่เป็นคลื่น ไม่มีน้ำขัง เป็นแอ่ง ไม่มีรอยแตกร้าว',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'ช่องเปิดบันไดได้ขนาดตามแบบ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'กรอบพื้น ± 2.00 ซม. จากระยะตามแบบ และตีเส้นฉาก เรียบร้อย',
        '', 'number', true, false, true,
        false, 'ซม.', 0.0, -2.0, 2.0, '[]'::jsonb
    );


    -- Form #12: QC-STR-009 - งานโครงสร้างเสา ชั้น 2
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-STR-009', 'งานโครงสร้างเสา ชั้น 2', 'แบบฟอร์มตรวจสอบ QC งานโครงสร้างเสา ชั้น 2 (ลำดับที่ 12 จากมาตรฐานโครงการ) (เฉพาะบ้าน 2 ชั้น)', 'งานโครงสร้าง', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ระยะศูนย์ เสา ถึง เสา ได้ระยะตามแบบ ± 1.00 ซม.',
        '', 'number', true, false, true,
        false, 'ซม.', 0.0, -1.0, 1.0, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'หลังถอดแบบ ตรวจสอบความสมบูรณ์ ของคอนกรีต ไม่เป็นโพรง เนื้อแน่น',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'เสาได้ขนาดตามแบบ± 1.00 ซม. ไม่บวม, ตรวจความมั่นคงของเสา',
        '', 'number', true, false, true,
        false, 'ซม.', 0.0, -1.0, 1.0, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'ไม่มีรอยร้าวของ คอนกรีต หลังเทเสร็จ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'ระยะดิ่งของเสาเอียงได้ ± 1.00 ซม. ความสูงของเสา ± 1.00 ซม. โดยใช้เส้นระดับในการวัด ไม่ใช่ระยะจากพื้น',
        '', 'number', true, false, true,
        false, 'ซม.', 0.0, -1.0, 1.0, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 6, 'การตรวจสอบทั่วไป', 'Q06', 'มีการเผื่อเหล็กสำหรับเพลทหลังคา ยาว 0.20 เมตร',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #13: QC-STR-010 - งานบันได ค.ส.ล.
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-STR-010', 'งานบันได ค.ส.ล.', 'แบบฟอร์มตรวจสอบ QC งานบันได ค.ส.ล. (ลำดับที่ 13 จากมาตรฐานโครงการ) (เฉพาะบ้าน 2 ชั้น)', 'งานโครงสร้าง', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ระยะลูกตั้งลูกนอนได้ตามแบบ ± 0.50 ซม.',
        '', 'number', true, false, true,
        false, 'ซม.', 0.0, -0.5, 0.5, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'หน้าบันได ตรง ไม่พริ้วหรือคดโก่ง',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'ความกว้าง ความสูง ได้ขนาดตามแบบ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'แกะไม่แบบออกทั้งหมด ไม่มีไม้แบบติดอยุ่กับคอนกรีต',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #14: QC-STR-011 - งานโครงสร้างหลังคา
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-STR-011', 'งานโครงสร้างหลังคา', 'แบบฟอร์มตรวจสอบ QC งานโครงสร้างหลังคา (ลำดับที่ 14 จากมาตรฐานโครงการ)', 'งานโครงสร้าง', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'เหล็กโครง อยู่ในสภาพที่ ไม่บิดเบี้ยว หรือมีรอยหักพับ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'สีกันสนิม ไม่หลุดร่อน ทาเต็มพื้นที่',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'ระยะรอยเชื่อมเหล็ก ประกบ เชื่อมเป็นช่วงๆ ระยะห่าง 0.50 ม. และ เชื่อมยาวไม่น้อยกว่า 5 ซม.',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'ระยะรอยเชื่่อมต่อเหล็ก เต็มแนว ตลอดแนว',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'เชื่อมเหล็กเส้น กับ Plate หัวเสา เชื่อม ด้านใต้เหล็กแผ่น และ บนเหล็กแผ่น',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 6, 'การตรวจสอบทั่วไป', 'Q06', 'เหล็กโครง อยู่ในสภาพที่ ไม่บิดเบี้ยว หรือมีรอยหักพับ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 7, 'การตรวจสอบทั่วไป', 'Q07', 'ทำความสะอาดเศษวัสดุและฝุ่นจากการก่อสร้างหน้างานให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #15: QC-ARC-001 - งานมุงหลังคา
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-001', 'งานมุงหลังคา', 'แบบฟอร์มตรวจสอบ QC งานมุงหลังคา (ลำดับที่ 15 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'การยึดวัสดุมุงหลังคา ด้วยสกรูทุกแผ่น ยึดแน่นมั่นคงไม่หลุดไม่เลื่อนขยับ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'หลังมุงหลังคา แนวสันแนวร่องวัสดุมุงตรงตามแนวของแต่ละแผ่น และแผ่นสุดท้ายแนบสนิทกับเชิงชาย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'ติดฟอยล์กันความร้อยใต้หลังคา เรียบสนิท ไม่ฉีกขาด และ เต็มทั่วทั้งกระเบื้องหลังคา',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'คุณภาพของเชิงชายแผ่นไฟเบอร์ซีเมนต์ ไม่มีรอยตำหนิ ไม่แตกไม่ร้าว',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'ระดับเชิงชายหลังจากติดตั้งได้ระดับในแนวราบตลอดแนว ไม่ตกท้องช้างเป็นจุด ไม่บิดพริ้ว',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 6, 'การตรวจสอบทั่วไป', 'Q06', 'รอยต่อเชิงชายเรียบสนิทและยึดด้วยสกรูอย่างน้อยฝั่งละ 2 ตัวตรงรอยต่อของแผ่น',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 7, 'การตรวจสอบทั่วไป', 'Q07', 'ทำความสะอาดเศษวัสดุและฝุ่นจากการก่อสร้างหน้างานให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #16: QC-SAN-001 - งานบ่อพักท่อใยหิน
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-SAN-001', 'งานบ่อพักท่อใยหิน', 'แบบฟอร์มตรวจสอบ QC งานบ่อพักท่อใยหิน (ลำดับที่ 16 จากมาตรฐานโครงการ)', 'งานระบบสุขาภิบาล', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ตำแหน่งของบ่อพักท่อใยหิน ตำแหน่งและระดับถูกต้อง',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'รอบๆขอบบ่อและฝาปิดไม่บิ่น ไม่แตก',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'เช็คค่าระดับ ให้ได้ตามระบุในแบบ ± 1 ซม.',
        '', 'number', true, false, true,
        false, 'ซม.', 0.0, -1.0, 1.0, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'ไม่มีดินหรือเศษวัสดุตกลงไปในบ่อพัก',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #17: QC-STR-012 - งานโครงสร้างรั้วหน้าบ้าน
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-STR-012', 'งานโครงสร้างรั้วหน้าบ้าน', 'แบบฟอร์มตรวจสอบ QC งานโครงสร้างรั้วหน้าบ้าน (ลำดับที่ 17 จากมาตรฐานโครงการ)', 'งานโครงสร้าง', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'คานได้ระดับ เหล็กเสริมถูกต้องตามแบบ',
        '', 'pass_fail_na', true, true, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'แนวคานและเสา ตรงได้แนว ไม่พริ้ว ไม่ล้มดิ่ง',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #18: QC-STR-013 - งานโครงสร้างรั้วข้างบ้าน
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-STR-013', 'งานโครงสร้างรั้วข้างบ้าน', 'แบบฟอร์มตรวจสอบ QC งานโครงสร้างรั้วข้างบ้าน (ลำดับที่ 18 จากมาตรฐานโครงการ)', 'งานโครงสร้าง', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'คานได้ระดับ เหล็กเสริมถูกต้องตามแบบ',
        '', 'pass_fail_na', true, true, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'แนวคานและเสา ตรงได้แนว ไม่พริ้ว ไม่ล้มดิ่ง',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #19: QC-STR-014 - งานโครงสร้างรั้วหลังบ้าน
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-STR-014', 'งานโครงสร้างรั้วหลังบ้าน', 'แบบฟอร์มตรวจสอบ QC งานโครงสร้างรั้วหลังบ้าน (ลำดับที่ 19 จากมาตรฐานโครงการ)', 'งานโครงสร้าง', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'คานได้ระดับ เหล็กเสริมถูกต้องตามแบบ',
        '', 'pass_fail_na', true, true, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'แนวคานและเสา ตรงได้แนว ไม่พริ้ว ไม่ล้มดิ่ง',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #20: QC-ARC-002 - งานก่อฉาบรั้วหน้าบ้าน
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-002', 'งานก่อฉาบรั้วหน้าบ้าน', 'แบบฟอร์มตรวจสอบ QC งานก่อฉาบรั้วหน้าบ้าน (ลำดับที่ 20 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ผนังฉาบไม่แตกร้าว ไม่ร่อน',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'แนวคานและทับหลังตรงได้แนว ไม่พริ้ว',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #21: QC-ARC-003 - งานก่อฉาบรั้วข้างบ้าน
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-003', 'งานก่อฉาบรั้วข้างบ้าน', 'แบบฟอร์มตรวจสอบ QC งานก่อฉาบรั้วข้างบ้าน (ลำดับที่ 21 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ผนังฉาบไม่แตกร้าว ไม่ร่อน',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'แนวคานและทับหลังตรงได้แนว ไม่พริ้ว',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #22: QC-ARC-004 - งานก่อฉาบรั้วหลังบ้าน
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-004', 'งานก่อฉาบรั้วหลังบ้าน', 'แบบฟอร์มตรวจสอบ QC งานก่อฉาบรั้วหลังบ้าน (ลำดับที่ 22 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ผนังฉาบไม่แตกร้าว ไม่ร่อน',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'แนวคานและทับหลังตรงได้แนว ไม่พริ้ว',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #23: QC-ARC-005 - งานก่ออิฐ ชั้น 1
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-005', 'งานก่ออิฐ ชั้น 1', 'แบบฟอร์มตรวจสอบ QC งานก่ออิฐ ชั้น 1 (ลำดับที่ 23 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ห้องได้ขนาดตามแบบ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'แนวก่อ แถวสุดท้าย ต้องก่อ ทะแยง ตลอดแนวที่ชิดคานด้านบน',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'การตั้งวงกบประตูได้ดิ่ง ได้ฉาก ได้แนว แข็งแรง และตรงตามแบบ เผื่อระดับงานแต่งผิวผนัง ห้องนอน 1 ห้องน้ำ 1 ห้องนอน 2 ห้องน้ำ 2 ห้องนอน 3 ห้องน้ำ 3 ห้องโถง ประตูโรงรถ ประตุห้องครัว',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'อิฐที่นำมาก่อต้องมีความสมบูรณ์ ไม่แตกไม่หัก',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'ความหนาปูนก่อ15 -20 มม. เต็มหน้าแผ่นอิฐ',
        '', 'number', true, false, true,
        false, 'มม.', 17.5, 15.0, 20.0, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 6, 'การตรวจสอบทั่วไป', 'Q06', 'แผงก่อต้องทำเสาเอ็นทับหลังกากบาทด้วย ตามระบุในแบบ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 7, 'การตรวจสอบทั่วไป', 'Q07', 'เสาเอ็นทั่วไปต้องกว้าง 10 ซม.',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #24: QC-ARC-006 - งานก่ออิฐ ชั้น 2
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-006', 'งานก่ออิฐ ชั้น 2', 'แบบฟอร์มตรวจสอบ QC งานก่ออิฐ ชั้น 2 (ลำดับที่ 24 จากมาตรฐานโครงการ) (เฉพาะบ้าน 2 ชั้น)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ห้องได้ขนาดตามแบบ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'แนวก่อ แถวสุดท้าย ต้องก่อ ทะแยง ตลอดแนวที่ชิดคานด้านบน',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'การตั้งวงกบประตูได้ดิ่ง ได้ฉาก ได้แนว แข็งแรง และตรงตามแบบ เผื่อระดับงานแต่งผิวผนัง ห้องนอน 1 ห้องน้ำ 1 ห้องนอน 2 ห้องน้ำ 2 ห้องนอน 3 ห้องน้ำ 3 ห้องโถง ประตูโรงรถ ประตุห้องครัว',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'อิฐที่นำมาก่อต้องมีความสมบูรณ์ ไม่แตกไม่หัก',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'ความหนาปูนก่อ15 -20 มม. เต็มหน้าแผ่นอิฐ',
        '', 'number', true, false, true,
        false, 'มม.', 17.5, 15.0, 20.0, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 6, 'การตรวจสอบทั่วไป', 'Q06', 'แผงก่อต้องทำเสาเอ็นทับหลังกากบาทด้วย ตามระบุในแบบ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 7, 'การตรวจสอบทั่วไป', 'Q07', 'เสาเอ็นทั่วไปต้องกว้าง 10 ซม.',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #25: QC-SAN-005 - งานฝากท่อประปา 2 ชั้น
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-SAN-005', 'งานฝากท่อประปา 2 ชั้น', 'แบบฟอร์มตรวจสอบ QC งานฝากท่อประปา 2 ชั้น (ลำดับที่ 25 จากมาตรฐานโครงการ) (เฉพาะบ้าน 2 ชั้น)', 'งานระบบสุขาภิบาล', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ท่อน้ำทิ้งทั้งหมดใช้ชั้น 5 ยกเว้นท่อโสโครกส่วนบนที่ฝากกับพื้น ให้ใช้ชั้น 8.5 ยี่ห้อวอเตอร์ไพพ์',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'ท่อน้ำดีทั้งหมดใช้ชั้น 8.5 ยี่ห้อน้ำไทย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'การผ่าผนังวางท่อ อิฐไม่แตกหักทั้งแผง อิฐไม่แตกเสียหาย ตรงตามแนวและเอ็นทับหลังไม่ขาด',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'ตำแหน่งและระยะได้ตามแบบ ข้องอสำหรับต่ออุปกรณ์ ก๊อกน้ำ ใช้เป็นเกลียวทองเหลือง',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'การต่อท่อทุกจุด ไม่มีการรั่ว อัดแรงดัน 4 bar เป็นเวลา 8 ชั่วโมง (ตรวจสอบจากรูปถ่าย)',
        '', 'number', true, true, true,
        true, 'bar', 4.0, 4.0, 5.0, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 6, 'การตรวจสอบทั่วไป', 'Q06', 'การยึดท่อก่อนฉาบผนัง มีการโป้วปูนปิดท่อ มั่นคงไม่เคลื่อน',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 7, 'การตรวจสอบทั่วไป', 'Q07', 'ฝากท่อเสร็จต้องโป้วปิดท่อเสมอ และต้องโป้วให้เต็ม (เฉพาะที่ฝังในผนัง)',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 8, 'การตรวจสอบทั่วไป', 'Q08', 'ใส่แฮงค์เกอร์แขวนท่อทุกขนาด',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #26: QC-SAN-006 - งานเดินประปานอก
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-SAN-006', 'งานเดินประปานอก', 'แบบฟอร์มตรวจสอบ QC งานเดินประปานอก (ลำดับที่ 26 จากมาตรฐานโครงการ)', 'งานระบบสุขาภิบาล', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ต่อท่อเข้าสู่ถังบำบัดน้ำเสียและเช็คค่าระดับ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'ท่อจาก บ่อบำบัดน้ำเสีย เข้าสู่บ่อพักท่อใยหิน พร้อมเช็คค่าระดับ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'สำหรับบ้าน 2 ชั้น ใส่ท่ออากาศช่องชาปให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'เปิดบ่อพักท่อใยหินไว้ เพื่อตรวจสอบการต่อท่อ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #27: QC-EXT-001 - งานปรับพื้นที่รอบบ้าน
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-EXT-001', 'งานปรับพื้นที่รอบบ้าน', 'แบบฟอร์มตรวจสอบ QC งานปรับพื้นที่รอบบ้าน (ลำดับที่ 27 จากมาตรฐานโครงการ)', 'งานภายนอก', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ปรับดินได้ระดับ +0.00 ม. จากระดับโครงการ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'พื้นที่รอบบ้านสะอาดเรียบร้อย ไม่มีเศษวัสดุหรือขยะอยู่รอบๆบริเวณ ดินเรียบ แตกเป็นก้อนเล้กๆ เต็มพื้นที่ ไม่เป็นหลุมเป็นบ่อหรือเป็นก้อนใหญ่',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #28: QC-ELC-001 - งานฝากท่อไฟฟ้า
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ELC-001', 'งานฝากท่อไฟฟ้า', 'แบบฟอร์มตรวจสอบ QC งานฝากท่อไฟฟ้า (ลำดับที่ 28 จากมาตรฐานโครงการ)', 'งานระบบไฟฟ้า', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ขนาดท่อ อุปกรณ์ข้อต่อ ชั้นคุณภาพ ตรงตาม spec ไม่ใช้ของเก่า',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'การผ่าผนังวางท่อ อิฐไม่แตกหักทั้งแผง อิฐไม่แตกเสียหาย ตรงตามแนวและเอ็นทับหลังไม่ขาด',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'ตำแหน่งและระยะได้ตามแบบ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'การยึดท่อก่อนฉาบผนัง มีการโป้วปูนปิดท่อ มั่นคงไม่เคลื่อน',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'ฝากท่อเสร็จต้องโป้วปิดท่อเสมอ และต้องโป้วให้เต็ม',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 6, 'การตรวจสอบทั่วไป', 'Q06', 'ตรวจสอบตำแหน่ง ท่อไฟฟ้าได้ตำแหน่งตามแบบ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #29: QC-ARC-007 - งานจับเซี๊ยม+ตีตาข่าย
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-007', 'งานจับเซี๊ยม+ตีตาข่าย', 'แบบฟอร์มตรวจสอบ QC งานจับเซี๊ยม+ตีตาข่าย (ลำดับที่ 29 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ตะแกรงกรงไก่ ติด ครอบ ส่วนที่เป็นโครงสร้าง และ ท่อไฟฟ้า PVC โดยเลยจากขอบ 0.10 ม.',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'งานเซี้ยม ขอบประตู หรือ หน้าต่างอลูมิเนียมได้ ขนาด ได้ระยะดิ่ง และฉาก',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'งานเซี้ยม มุมผนัง มุมเสา ขอบ ผนังต่างๆ ได้ระยะดิ่ง และแนวตั้งฉากกับพื้น',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'มีเป้าระดับในการฉาบผนัง ทุกๆ 2 ตร.ม.',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #30: QC-ARC-008 - งานฉาบผนังภายใน
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-008', 'งานฉาบผนังภายใน', 'แบบฟอร์มตรวจสอบ QC งานฉาบผนังภายใน (ลำดับที่ 30 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ผิวหน้าหลังฉาบเรียบสนิท ไม่เป็นคลื่น ไม่เป็นตามด ไม่แตกร้าว และไม่มีเศษวัสดุอื่นปนในผนัง',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'เก็บเศษปูนจากพื้น พร้อมทำความสะอาดพื้นให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'ฉาบคานชั้น 1 ให้ถึงท้องคาน และ ทำความสะอาดเศษปูน ข้างคานให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'เช็คฉากของช่องเปิด ไม่บิด ไม่พริ้ว',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'ที่ความสูง 0.1 ม. จากพื้น ตรวจความตรงของผนังโดยใช้ สามเหลี่ยมทาบ คลาดเคลื่อนไม่เกิน 3 มม.',
        '', 'number', true, false, true,
        true, 'มม.', NULL, 0.0, 3.0, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 6, 'การตรวจสอบทั่วไป', 'Q06', 'วัดระยะความกว้าง ยาว ของห้อง ตรงตามแบบ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 7, 'การตรวจสอบทั่วไป', 'Q07', 'ความหนาของการฉาบผนัง ขอบวงกบอลูมิเนียมต้องได้ 10 cm',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 8, 'การตรวจสอบทั่วไป', 'Q08', 'เช็คแนวฉาก ของมุม เสา กับผนัง ต้องได้ฉาก',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 9, 'การตรวจสอบทั่วไป', 'Q09', 'ตรวจสอบบริเวณโถงบันได้ ไม่ให้เป็นคลื่น หรือ ผิวหยาบ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #31: QC-ARC-009 - งานฉาบผนังภายนอก
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-009', 'งานฉาบผนังภายนอก', 'แบบฟอร์มตรวจสอบ QC งานฉาบผนังภายนอก (ลำดับที่ 31 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ผิวหน้าหลังฉาบเรียบสนิท ไม่เป็นคลื่น ไม่เป็นตามด ไม่แตกร้าว และไม่มีเศษวัสดุอื่นปนในผนัง',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'เก็บเศษปูนจากพื้น พร้อมทำความสะอาดพื้นให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'ตรวจสอบในห้องเก็บของ มีการก่อขึ้นมาที่ปลายมุมบันได',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'ช่องเปิดเสาโชว์ ได้ระยะตามแบบ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'ที่ความสูง 0.1 ม. จากพื้น ตรวจความตรงของผนังโดยใช้ สามเหลี่ยมทาบ คลาดเคลื่อนไม่เกิน 3 มม.',
        '', 'number', true, false, true,
        true, 'มม.', NULL, 0.0, 3.0, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 6, 'การตรวจสอบทั่วไป', 'Q06', 'วัดระยะความกว้าง ยาว ของห้อง ตรงตามแบบ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 7, 'การตรวจสอบทั่วไป', 'Q07', 'ความหนาของการฉาบผนัง ขอบวงกบอลูมิเนียมต้องได้ 10 cm',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 8, 'การตรวจสอบทั่วไป', 'Q08', 'เช็คแนวฉาก ของมุม เสา กับผนัง ต้องได้ฉาก',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #32: QC-STR-015 - งานเทพื้นโรงรถ+ฝาบ่อ+ฐานแทงค์น้ำ
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-STR-015', 'งานเทพื้นโรงรถ+ฝาบ่อ+ฐานแทงค์น้ำ', 'แบบฟอร์มตรวจสอบ QC งานเทพื้นโรงรถ+ฝาบ่อ+ฐานแทงค์น้ำ (ลำดับที่ 32 จากมาตรฐานโครงการ)', 'งานโครงสร้าง', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'หลังเทคอนกรีตเรียบเสมอ ไม่เป็นคลื่น ไม่มีน้ำขัง เป็นแอ่ง ไม่มีรอยแตกร้าว',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'ระดับพื้นได้ตามแบบที่ระบุ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'ขนาดและขอบพื้น ไม่เบี้ยวไม่คด ได้แนวได้ฉาก',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #33: QC-STR-016 - งานเทฐานถังขยะ
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-STR-016', 'งานเทฐานถังขยะ', 'แบบฟอร์มตรวจสอบ QC งานเทฐานถังขยะ (ลำดับที่ 33 จากมาตรฐานโครงการ)', 'งานโครงสร้าง', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ขนาดและตำแหน่งเป็นไปตามแบบ ต่ำกว่าหลังคานหน้าบ้าน 0.10 เมตร',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'ถังขยะได้มุมได้ฉาก ไม่พริ้ว ไม่คด มีการฝากท่อระบายน้ำเสีย พร้อมทำสโลป',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #34: QC-ARC-010 - งานบัวปูนปั้น
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-010', 'งานบัวปูนปั้น', 'แบบฟอร์มตรวจสอบ QC งานบัวปูนปั้น (ลำดับที่ 34 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ขนาดของบัวตรงตามแบบ ความแข็งแรงของบัวปูนปั้น และลักษณะของบัวไม่มีรอยบิ่น',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'บัวตกแต่งแนบสนิทติดกับผนังและพื้นตลอดทั้งแผ่น',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'เก็บปูนรอยต่อผนังให้เรียบสนิท',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'ทำวคามสะอาดเศษวัสดุและฝุ่นจากการทำงานให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #35: QC-ARC-011 - งานไม้ตกแต่ง
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-011', 'งานไม้ตกแต่ง', 'แบบฟอร์มตรวจสอบ QC งานไม้ตกแต่ง (ลำดับที่ 35 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'การติดตั้งไม้ตกแต่งได้ระดับตลอดแนว เป็นระนาบเดียวกันตลอด',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'ไม้ตกแต่งแนบสนิทติดกับผนังและพื้นตลอดทั้งแผ่น',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'ไม้ตกแต่งไม่แตกหรือบิ่น',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'ทำวคามสะอาดเศษวัสดุและฝุ่นจากการทำงานให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #36: QC-ARC-012 - งานระเบียงเหล็ก
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-012', 'งานระเบียงเหล็ก', 'แบบฟอร์มตรวจสอบ QC งานระเบียงเหล็ก (ลำดับที่ 36 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'เหล็กถูกขนาดตามแบบ เชื่อมติดกับโครงสร้าง ไม่สั่นคลอน',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'เหล็กซี่ ต้องเชื่อมสองด้าน ไม่เชื่อมแต๊ก รอยเชื่อมไม่ปูด ไม่ทะลุ เก็บสีกันสนิมให้เรียบร้อย เหล็กได้แนวได้ฉาก ไม่เอียง เว้นระยะช่องไฟเท่ากัน',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #37: QC-ARC-013 - งานเทปรับพื้น SPC
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-013', 'งานเทปรับพื้น SPC', 'แบบฟอร์มตรวจสอบ QC งานเทปรับพื้น SPC (ลำดับที่ 37 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'หลังจากเทปรับแล้ว ต้องไม่มีเศษวัสดุ ฝุ่น หรือ ปูนบนพื้น',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'พื้นผิวต้องขัดเรียบ ได้ระดับทั้งห้อง ตรวจด้วยไม้สามเหลี่ยม ± 3 มม.',
        '', 'number', true, false, true,
        false, 'มม.', 0.0, -3.0, 3.0, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'ลุกตั้ง ลูกนอนบันได ชานพัก ได้ระยะตามแบบ ± 5 มม.',
        '', 'number', true, false, true,
        false, 'มม.', 0.0, -5.0, 5.0, '[]'::jsonb
    );


    -- Form #38: QC-ELC-002 - งานร้อยสายไฟ
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ELC-002', 'งานร้อยสายไฟ', 'แบบฟอร์มตรวจสอบ QC งานร้อยสายไฟ (ลำดับที่ 38 จากมาตรฐานโครงการ)', 'งานระบบไฟฟ้า', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ขนาดและสายไฟ สีของสายตรงตาม Spec และ เฟสของไฟฟ้า ไม่ใช้ของเก่า',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'การเดินท่อหลังฝ้าเพดาน เป็นระเบียบเรียบร้อย พร้อมใช้ก้ามปูในการยึดท่อให้มั่นคงไม่หย่อน',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'จุดต่อสายไฟหลังฝ้าเพดานไม่มีการต่อในท่อให้ต่อในกล่องเท่านั้น การต่อไม่มากจนล้นบล็อกและปิดฝาให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'ขนาดบล็อต้องพอดีกับจำนวนสายที่ต่อ และมีการพันเทปให้แน่นทุกจุด ไม่หลุดง่าย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'การดัดงอท่อไฟฟ้า ห้ามใช้วิธีต่อตัอท่อด้วยมีด ให้งอด้วยวิธีขดลวดสปริงเท่านั้น',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 6, 'การตรวจสอบทั่วไป', 'Q06', 'สายไฟตรงท่อที่ตู้ Load Center เมื่อร้อยแล้วไม่แน่นเกิน และฉนวนไม่หลุดรอก ไม่มีรอยขาด',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #39: QC-ARC-014 - งานฝ้าเพดาน(ยกเว้นห้องน้ำ)
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-014', 'งานฝ้าเพดาน(ยกเว้นห้องน้ำ)', 'แบบฟอร์มตรวจสอบ QC งานฝ้าเพดาน(ยกเว้นห้องน้ำ) (ลำดับที่ 39 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'การโป้วรอยต่อฝ้าเพดานให้เรียบ มีผ้าดิบรองเสมอ โป้วเดิมตลอด และหัวน็อตโป้วเก็บเรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'การปิดรอยโป้วฝ้าเพดานเรียบเสมอไม่เป็นคลื่น ทั้งกลางแผ่นและขอบฝ้ากับผนัง ได้ระนาบตลอด',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'ยิงกรูให้จม ไม่มีหัวสกรูโผล่',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'ฝ้าหลุมได้แนวได้ฉาก ไม่พริ้ว',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'ฝ้าภายนอกไม่หย่อน ไม่พริ้ว มุมบ้านใส่เป็นช่องระบายอากาศ ไม่มีรอยดินสอติดที่กระเบื้องผนัง ถ้ามีก็ทำวคามสะอาดให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 6, 'การตรวจสอบทั่วไป', 'Q06', 'ทำความสะอาดเศษวัสดุ ฝุ่น และ แซะปูนโป๊วที่กระเด็นติดผนังหรือพื้นให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #40: QC-EXT-002 - งานรั้วเหล็ก
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-EXT-002', 'งานรั้วเหล็ก', 'แบบฟอร์มตรวจสอบ QC งานรั้วเหล็ก (ลำดับที่ 40 จากมาตรฐานโครงการ)', 'งานภายนอก', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'เหล็กถูกขนาดตามแบบ เชื่อมติดกับโครงสร้าง ไม่สั่นคลอน',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'เหล็กซี่ ต้องเชื่อมสองด้าน ไม่เชื่อมแต๊ก รอยเชื่อมไม่ปูดไม่ทะลุ การติดตั้งรั้ว ติดได้ระดับไม่เอียง ไม่เบี้ยว ได้ดิ่ง ไม่โยก แน่นหนา ขนาดและระดับหลังคาน และ ความสูงเสาถูกต้อง ช่องด้านล่าง 0.10 ซม.',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #41: QC-EXT-003 - งานประตูเลื่อนเหล็ก
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-EXT-003', 'งานประตูเลื่อนเหล็ก', 'แบบฟอร์มตรวจสอบ QC งานประตูเลื่อนเหล็ก (ลำดับที่ 41 จากมาตรฐานโครงการ)', 'งานภายนอก', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'วางเหล็กเพลารางประตู ได้ระดับ ได้คด เอียง มั่นคง ไม่สั่นคลอน',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'การติดตั้งประตูรั้ว ติดได้ระดับไม่เอียง ได้ดิ่ง ไม่โยก แน่นหนา เปิดปิดสะดวก ไม่ฝืด หูจับกับชุดล็อก ตรงกันและล็อคได้สะดวก จุดที่ยึดกับรั้วต้องยึดเข้ากับเสาคอนกรีต ถ้ารั้วแตกให้เก็บงานให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #42: QC-ARC-015 - งานสีรองพื้น
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-015', 'งานสีรองพื้น', 'แบบฟอร์มตรวจสอบ QC งานสีรองพื้น (ลำดับที่ 42 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'เบอร์ สี และ ประเภท สี ที่ใช้ทา ตรงตามแบบที่ระบุ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'ตอนทาสีรองพื้น ต้องทาให้เต็มพื้นที่ และสีรองพื้นไม่จางมากเกินไปเนื้อสีที่ทา สม่ำเสมอกันตลอด',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'ทาสีฝ้า เต็มพื้นที่ สม่ำเสมอ ไม่เป็นรอยแปรงหรือรอยลูกกลิ้ง',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #43: QC-ARC-016 - งานกระเบื้องห้องน้ำ
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-016', 'งานกระเบื้องห้องน้ำ', 'แบบฟอร์มตรวจสอบ QC งานกระเบื้องห้องน้ำ (ลำดับที่ 43 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'สีและรหัสกระเบื้องปูตรงตามแบบ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'กาวปูหรือกรุกระเบื้องต้องให้เต็ม ไม่โก่ง และไม่เป็นโพรงใต้กระเบื้อง กระเบื้องไม่หลุดร่อน',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'ร่องระหว่างกระเบื้องตรงกันตลอด และขนาดร่องขนาด 2 มม.',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'มุมกระเบื้อง 4 มุม ชนกันต้องมีระยะห่างเท่าๆกัน เรียบเสมอกัน ไม่เป็นเล็บ เดินไม่สะดุดตามมุมกระเบื้อง',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'ทำกกันซึมเรียบร้อย เช็คสโลปการไหลของน้ำ ไม่ให้มีการขัง รวมถึงช่องสบู่',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 6, 'การตรวจสอบทั่วไป', 'Q06', 'ความสะอาดหลังปูเสร็จ เช็ดทำความสะอาดคราบยาแนวให้หมด',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #44: QC-ARC-017 - งานกระเบื้องพื้น
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-017', 'งานกระเบื้องพื้น', 'แบบฟอร์มตรวจสอบ QC งานกระเบื้องพื้น (ลำดับที่ 44 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'สีและรหัสกระเบื้องปูตรงตามแบบ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'กาวปูหรือกรุกระเบื้องต้องให้เต็ม ไม่โก่ง และไม่เป็นโพรงใต้กระเบื้อง กระเบื้องไม่หลุดร่อน',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'ร่องระหว่างกระเบื้องตรงกันตลอด และขนาดร่องขนาด 2 มม.',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'มุมกระเบื้อง 4 มุม ชนกันต้องมีระยะห่างเท่าๆกัน เรียบเสมอกัน ไม่เป็นเล็บ เดินไม่สะดุดตามมุมกระเบื้อง',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'ความสะอาดหลังปูเสร็จ เช็ดทำความสะอาดคราบยาแนวให้หมด',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #45: QC-ARC-018 - งานกระเบื้องระเบียงหน้า
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-018', 'งานกระเบื้องระเบียงหน้า', 'แบบฟอร์มตรวจสอบ QC งานกระเบื้องระเบียงหน้า (ลำดับที่ 45 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'สีและรหัสกระเบื้องปูตรงตามแบบ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'กาวปูหรือกรุกระเบื้องต้องให้เต็ม ไม่โก่ง และไม่เป็นโพรงใต้กระเบื้อง กระเบื้องไม่หลุดร่อน',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'ร่องระหว่างกระเบื้องตรงกันตลอด และขนาดร่องขนาด 2 มม.',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'มุมกระเบื้อง 4 มุม ชนกันต้องมีระยะห่างเท่าๆกัน เรียบเสมอกัน ไม่เป็นเล็บ เดินไม่สะดุดตามมุมกระเบื้อง',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'ความสะอาดหลังปูเสร็จ เช็ดทำความสะอาดคราบยาแนวให้หมด',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #46: QC-ARC-019 - งานกระเบื้องระเบียงชั้น 2
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-019', 'งานกระเบื้องระเบียงชั้น 2', 'แบบฟอร์มตรวจสอบ QC งานกระเบื้องระเบียงชั้น 2 (ลำดับที่ 46 จากมาตรฐานโครงการ) (เฉพาะบ้าน 2 ชั้น)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'สีและรหัสกระเบื้องปูตรงตามแบบ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'กาวปูหรือกรุกระเบื้องต้องให้เต็ม ไม่โก่ง และไม่เป็นโพรงใต้กระเบื้อง กระเบื้องไม่หลุดร่อน',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'ร่องระหว่างกระเบื้องตรงกันตลอด และขนาดร่องขนาด 2 มม.',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'มุมกระเบื้อง 4 มุม ชนกันต้องมีระยะห่างเท่าๆกัน เรียบเสมอกัน ไม่เป็นเล็บ เดินไม่สะดุดตามมุมกระเบื้อง',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'ทำกันซึมเรียบร้อย เอียงสโลปให้น้ำระบายออก ไม่ขังด้านชิดผนัง',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 6, 'การตรวจสอบทั่วไป', 'Q06', 'ความสะอาดหลังปูเสร็จ เช็ดทำความสะอาดคราบยาแนวให้หมด',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #47: QC-ARC-020 - งานกระเบื้องระเบียงหลัง
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-020', 'งานกระเบื้องระเบียงหลัง', 'แบบฟอร์มตรวจสอบ QC งานกระเบื้องระเบียงหลัง (ลำดับที่ 47 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'สีและรหัสกระเบื้องปูตรงตามแบบ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'กาวปูหรือกรุกระเบื้องต้องให้เต็ม ไม่โก่ง และไม่เป็นโพรงใต้กระเบื้อง กระเบื้องไม่หลุดร่อน',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'ร่องระหว่างกระเบื้องตรงกันตลอด และขนาดร่องขนาด 2 มม.',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'มุมกระเบื้อง 4 มุม ชนกันต้องมีระยะห่างเท่าๆกัน เรียบเสมอกัน ไม่เป็นเล็บ เดินไม่สะดุดตามมุมกระเบื้อง',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'ความสะอาดหลังปูเสร็จ เช็ดทำความสะอาดคราบยาแนวให้หมด',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #48: QC-ARC-021 - งานกระเบื้องเคาท์เตอร์
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-021', 'งานกระเบื้องเคาท์เตอร์', 'แบบฟอร์มตรวจสอบ QC งานกระเบื้องเคาท์เตอร์ (ลำดับที่ 48 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'สีและรหัสกระเบื้องปูตรงตามแบบ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'กาวปูหรือกรุกระเบื้องต้องให้เต็ม ไม่โก่ง และไม่เป็นโพรงใต้กระเบื้อง กระเบื้องไม่หลุดร่อน',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'ร่องระหว่างกระเบื้องตรงกันตลอด และขนาดร่องขนาด 2 มม.',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'มุมกระเบื้อง 4 มุม ชนกันต้องมีระยะห่างเท่าๆกัน เรียบเสมอกัน ไม่เป็นเล็บ เดินไม่สะดุดตามมุมกระเบื้อง',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'ตรวจสอบตำแหน่งหลุมอ่างล้างจานให้ถูกต้องตามแบบ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 6, 'การตรวจสอบทั่วไป', 'Q06', 'ความสะอาดหลังปูเสร็จ เช็ดทำความสะอาดคราบยาแนวให้หมด',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #49: QC-ARC-022 - งานติดตั้งบานซิงค์
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-022', 'งานติดตั้งบานซิงค์', 'แบบฟอร์มตรวจสอบ QC งานติดตั้งบานซิงค์ (ลำดับที่ 49 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ติดตั้งบานซิงค์ถูกต้องตามแบบ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'บานที่ติดตั้งแล้วไม่เอียง ได้ระดับ ช่องไฟรอบตัวเท่ากัน',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'ประตูซิ้งค์ เปิดปิดง่าย ไม่ฝืด ได้ดิ่งได้ฉาก',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'เก็บซิลิโคนรอบบานให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'ทำวคามสะอาดเศษวัสดุและฝุ่นจากการทำงานให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #50: QC-ARC-023 - งานฝ้าห้องน้ำ
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-023', 'งานฝ้าห้องน้ำ', 'แบบฟอร์มตรวจสอบ QC งานฝ้าห้องน้ำ (ลำดับที่ 50 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'การโป้วรอยต่อฝ้าเพดานให้เรียบ มีผ้าดิบรองเสมอ โป้วเดิมตลอด และหัวน็อตโป้วเก็บเรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'การปิดรอยโป้วฝ้าเพดานเรียบเสมอไม่เป็นคลื่น ทั้งกลางแผ่นและขอบฝ้ากับผนัง ได้ระนาบตลอด',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'ยิงกรูให้จม ไม่มีหัวสกรูโผล่',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'ฝ้าหลุมได้แนวได้ฉาก ไม่พริ้ว',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'ฝ้าห้องน้ำต้องใช้แผ่นฝ้ากันชื้นเท่านั้น ไม่มีรอยดินสอติดที่กระเบื้องผนัง ถ้ามีก็ทำวคามสะอาดให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 6, 'การตรวจสอบทั่วไป', 'Q06', 'ทำความสะอาดเศษวัสดุ ฝุ่น และ แซะปูนโป๊วที่กระเด็นติดผนังหรือพื้นให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #51: QC-ARC-024 - งานทาสีจริงรอบที่ 1
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-024', 'งานทาสีจริงรอบที่ 1', 'แบบฟอร์มตรวจสอบ QC งานทาสีจริงรอบที่ 1 (ลำดับที่ 51 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'เบอร์ สี และ ประเภท สี ที่ใช้ทา ตรงตามแบบที่ระบุ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'พื้นผิวผนังหลังทาสีมีความเรียบ ไม่มีเศษปูนติดเป็นจุดๆ ไม่เป็นเม็ดทรายหยาบ ไม่เป็นคลื่นไม่เป็นตามด',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'การโป้วแต่งรอยร้าวเล็กๆโป้ว เรียบขัดอย่างดี เรียบกันไม่เป็นคลื่น',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'บัวปูนปั้นและไม้ตกแต่ง รอยต่อต้องเรียบร้อย ไม่มีรอยแตก พื้นผิวต้องเรียบเสมอกัน ไม่เป็นคลื่น',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'ทาสีวงกบประตูให้เรียบร้อย ขัดโป๊ววงกบประตูให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #52: QC-ARC-025 - งานติดตั้งประตูและซับวงกบ
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-025', 'งานติดตั้งประตูและซับวงกบ', 'แบบฟอร์มตรวจสอบ QC งานติดตั้งประตูและซับวงกบ (ลำดับที่ 52 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ติดตั้งบานประตูแนบสนิทตลอดไม่กระพือ ได้ดิ่งได้ฉาก เปิดปิดสะดวก และตรงตามแบบ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'ช่องไฟ ของบานประตูกับวงกบต้อง มีระยะห่างเท่ากันตลอด ไม่เกิน 2 มม.',
        '', 'number', true, false, true,
        false, 'มม.', NULL, 0.0, 2.0, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'ตรวจสอบสภาพของบานประตู ไม่คด ไม่โก่ง',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'ตีนประตูและบนประตูต้องมีช่องว่าง ไม่เกิน 5 มม.',
        '', 'number', true, false, true,
        false, 'มม.', NULL, 0.0, 5.0, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'ติดตั้งลูกบิด ล๊อคได้สนิทไม่ฝืดไม่ค้าง',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 6, 'การตรวจสอบทั่วไป', 'Q06', 'ทำความสะอาดบานประตู วงกบ ไม่มีรอยดินสอหรือฝุ่นจากการไสไม้',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 7, 'การตรวจสอบทั่วไป', 'Q07', 'รอยต่อซับวงกบเรียบสนิท ไม่บิ่นไม่แตก',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 8, 'การตรวจสอบทั่วไป', 'Q08', 'ทำวคามสะอาดเศษวัสดุและฝุ่นจากการทำงานให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #53: QC-ARC-026 - งานบัวกันเปื้อน
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-026', 'งานบัวกันเปื้อน', 'แบบฟอร์มตรวจสอบ QC งานบัวกันเปื้อน (ลำดับที่ 53 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'บัวกันเปื้อนได้แนวได้ฉากไม่พริ้ว',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'บัวตกแต่งแนบสนิทติดกับผนังและพื้นตลอดทั้งแผ่น',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'การต่อบัวต่อด้วยมุม 45 องศา ห้ามต่อตรง',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'ยิงสกรูให้หัวจม และโป๊วเก็บรอยตะปูให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'ทำวคามสะอาดเศษวัสดุและฝุ่นจากการทำงานให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #54: QC-ARC-027 - งานติดตั้งอลูมิเนียม
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-027', 'งานติดตั้งอลูมิเนียม', 'แบบฟอร์มตรวจสอบ QC งานติดตั้งอลูมิเนียม (ลำดับที่ 54 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ขนาด จำนวนบาน และ รูปแบบ ถูกต้องตามแบบ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'มีการเทสน้ำหลังจากติดตั้ง โดยฉีดน้ำทิ้งไว้อย่างน้อยบานละ 1 นาที',
        '', 'pass_fail_na', true, true, true,
        true, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'กรอบอลูมิเนียมไม่มีรอยขีดข่วนหรือรอยถลอกหลังติดตั้งเสร็จ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'ช่องไฟรอบๆกรอบต้องมีขนาดเท่าๆกัน ไม่เกิน 5 มม.',
        '', 'number', true, false, true,
        false, 'มม.', NULL, 0.0, 5.0, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'เก็บยาแนวเรียบร้อยทั้งภายในและภายนอก ไม่เลอะบานอลูมิเนียม',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 6, 'การตรวจสอบทั่วไป', 'Q06', 'ปิดจุกรูกรู ตัวเบรคบานประตุให้อุดรูน๊อตด้วยซิลิโคน',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 7, 'การตรวจสอบทั่วไป', 'Q07', 'บานประตูหน้าต่าง เปิดได้สะดวกไม่ฝืด ล๊อคได้',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 8, 'การตรวจสอบทั่วไป', 'Q08', 'ทำวคามสะอาดเศษวัสดุและฝุ่นจากการทำงานให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #55: QC-ELC-003 - งานติดตั้งอุปกรณ์ไฟฟ้า
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ELC-003', 'งานติดตั้งอุปกรณ์ไฟฟ้า', 'แบบฟอร์มตรวจสอบ QC งานติดตั้งอุปกรณ์ไฟฟ้า (ลำดับที่ 55 จากมาตรฐานโครงการ)', 'งานระบบไฟฟ้า', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'spec ของอุปกรณ์ไฟฟ้าได้ตรงตามแบบ ไม่ใช้ของเก่า',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'หน้ากากปลั๊กสวิตซ์ ไม่เอียง ช่องไฟขนาดเท่ากัน',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'การติดตั้งปลั๊กและกระดิ่ง แน่นสนิท ไม่หลุด ไม่เอียง มั่นคง และตำแหน่งถูกต้องตามแบบ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'ตำแหน่ง ขนาดลูกเซอร์กิต เรียงตามแบบ และติดสติกเกอร์ ลูกเซอร์กิตครบทุกช่อง',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'ระบุสีเฟสของสายไฟ ก่อนเข้ามิเตอร์ไฟฟ้า และ เก็บสายเมนเป็นระเบียบเรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 6, 'การตรวจสอบทั่วไป', 'Q06', 'มีหน้ากากปิดบล็อกสายไฟเครื่องทำน้ำอุ่นในห้องน้ำ และ สำหรับจุดติดแอร์',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 7, 'การตรวจสอบทั่วไป', 'Q07', 'สายเมนต์ไฟฟ้าตรงตามเบอร์ที่การไฟฟ้ากำหนด และการเข้าตู้ไฟตรงตาม Spec ไฟฟ้า',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 8, 'การตรวจสอบทั่วไป', 'Q08', 'ทำวคามสะอาดเศษวัสดุและฝุ่นจากการทำงานให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 9, 'การตรวจสอบทั่วไป', 'Q09', 'ไฟกระดิ่งต้องไปที่สวิตช์ ไม่ใช่ไฟมาที่ตัวกระดิ่ง',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #56: QC-ELC-004 - งานพาดเมนไฟฟ้า
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ELC-004', 'งานพาดเมนไฟฟ้า', 'แบบฟอร์มตรวจสอบ QC งานพาดเมนไฟฟ้า (ลำดับที่ 56 จากมาตรฐานโครงการ)', 'งานระบบไฟฟ้า', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ขนาดของสายไฟเมนถูกต้องตามแบบ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'สายเมนที่ขึ้นจากดินในตัวบ้าน ต้องมีกล่องสำหรับต่อสาย และปลายเสาต้องใส่หัวงูเห่า',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'สายเมนตึง มีการพันเก็บสายเรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #57: QC-ARC-028 - งานติดไม้ราวบันได
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-028', 'งานติดไม้ราวบันได', 'แบบฟอร์มตรวจสอบ QC งานติดไม้ราวบันได (ลำดับที่ 57 จากมาตรฐานโครงการ) (เฉพาะบ้าน 2 ชั้น)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ไม้แนบชิดกับราวเสมอกันทั้งแนว',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'ไม้ตรงได้แนว ไม่บิด ไม่พริ้ว',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'การยิงสกรูยิงจนหัวจม',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'ทำวคามสะอาดเศษวัสดุและฝุ่นจากการทำงานให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'รอยต่อไม้เรียบสนิท โป๊วปิดให้เรียบร้อย ชุดอุปกรณ์ยึดไม้ราวบันไดแน่น ไม่สั่นคลอน',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #58: QC-SAN-007 - งานติดตั้งแทงค์น้ำ
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-SAN-007', 'งานติดตั้งแทงค์น้ำ', 'แบบฟอร์มตรวจสอบ QC งานติดตั้งแทงค์น้ำ (ลำดับที่ 58 จากมาตรฐานโครงการ)', 'งานระบบสุขาภิบาล', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ต่อเป็นระบบ by passed มีวาล์ว 1 ตัว และเช็ควาล์วสปริง 1 ตัว',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'ติดตั้งอุปกรณ์ ครบตามแบบ มีวาล์ว ก่อนเข้าปั๊ม และ หลัง ปั๊ม',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'มีการเทสการใช้งานว่าใช้งานได้จริง',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'ต่อท่อเข้าสู่ถังบำบัดน้ำเสียและเช็คค่าระดับ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'ปั๊มน้ำ ห้ามตัดปลั๊กตัวผู้ออก',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 6, 'การตรวจสอบทั่วไป', 'Q06', 'ต่อระบบไฟฟ้ามายัง ปั้ม ให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 7, 'การตรวจสอบทั่วไป', 'Q07', 'ทำวคามสะอาดเศษวัสดุและฝุ่นจากการทำงานให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #59: QC-SAN-008 - งานติดตั้งสุขภัณฑ์
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-SAN-008', 'งานติดตั้งสุขภัณฑ์', 'แบบฟอร์มตรวจสอบ QC งานติดตั้งสุขภัณฑ์ (ลำดับที่ 59 จากมาตรฐานโครงการ)', 'งานระบบสุขาภิบาล', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'อุปกรณ์สุขภัณฑ์ สายน้ำดี มินิบอลวาล์ว ตรงตาม Spec ไม่ใช้ของเก่า ติดตั้งตรงตำแหน่งในแบบ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'การเดินท่อ การต่อท่อกับอุปกรณ์ มั่นคงไม่มีน้ำหยด แน่นทุกจุด',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'การยาแนวชักโครกใช้ปูนยาแนว ให้สวยงามไม่ยุบไม่ปูด',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'การติดตั้งสุขภัณฑ์ไม่โยกไม่สั่นคลอน มั่นคง ตรงไม่เอียง แนบสนิททุกชิ้น ยิงสกรูเรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'การยาแนวอ่างล้างหน้า และที่ใส่กระดาษชำระ ให้ใช้ซีแลนท์สีขาวแบบกันน้ำ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 6, 'การตรวจสอบทั่วไป', 'Q06', 'เช็ดคราบยาแนวชักโครกและอุปกรณ์เซรามิก ให้หมด',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 7, 'การตรวจสอบทั่วไป', 'Q07', 'เช็คระบบน้ำดี และน้ำเสียทั้งหมด ไม่มีจุดรั่วซึม และตัน (Test ระบบ พร้อมทดสอบแรงดัน',
        '', 'pass_fail_na', true, true, true,
        true, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 8, 'การตรวจสอบทั่วไป', 'Q08', 'ทำวคามสะอาดเศษวัสดุและฝุ่นจากการทำงานให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #60: QC-ARC-029 - งานปูพื้นไม้ SPC
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-029', 'งานปูพื้นไม้ SPC', 'แบบฟอร์มตรวจสอบ QC งานปูพื้นไม้ SPC (ลำดับที่ 60 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'บัวกันเปื้อนได้ระดับ ได้ดิ่ง ได้ฉาก ไม่เอียงไม่เบี้ยว',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'การต่อบัวกันเปื้อนต้องเข้ามุม 45 องศา รอยต่อต้องเล็กที่สุดไม่ปูดออก',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'แผ่นไม้เรียงชิด แนบกันสนิท ไม่มีร่องให้ขยับได้',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'แผ่นไม้เดินเหยียบแล้วต้องไม่รู้สึกยวบหรือปูดขึ้นมาจนรู้สึกได้ เดินแล้วไม่มีเสียงดัง',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'ระยะลูกตั้งลูกนอน ชานพักบันได ได้ขนาดตามแบบ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 6, 'การตรวจสอบทั่วไป', 'Q06', 'ทำความสะอาดเศษวัสดุและฝุ่นจากการทำงานให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #61: QC-ARC-030 - งานทาสีจริงรอบที่ 2
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-030', 'งานทาสีจริงรอบที่ 2', 'แบบฟอร์มตรวจสอบ QC งานทาสีจริงรอบที่ 2 (ลำดับที่ 61 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'เบอร์ สี และ ประเภท สี ที่ใช้ทา ตรงตามแบบที่ระบุ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'พื้นผิวผนังหลังทาสีมีความเรียบ ไม่มีเศษปูนติดเป็นจุดๆ ไม่เป็นเม็ดทรายหยาบ ไม่เป็นคลื่นไม่เป็นตามด',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'การโป้วแต่งรอยร้าวเล็กๆโป้ว เรียบขัดอย่างดี เรียบกันไม่เป็นคลื่น',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'ทาสีรอบอุปกรณ์ไฟฟ้า พร้อมทำความสะอาดให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'เก็บสีจากงานอลูมิเนียม ให้ใช้น้ำเปล่าเช็ดสีที่เปื้อนออกให้หมด',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #62: QC-EXT-004 - งานทาสีรั้ว+ประตูเหล็ก
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-EXT-004', 'งานทาสีรั้ว+ประตูเหล็ก', 'แบบฟอร์มตรวจสอบ QC งานทาสีรั้ว+ประตูเหล็ก (ลำดับที่ 62 จากมาตรฐานโครงการ)', 'งานภายนอก', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ทาสีรั้วเต็มพื้นที่ ไม่ให้สีหยดเลอะลงบนรั้วปูน',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'เก็บสีที่เกิดจากรายสนิมให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #63: QC-EXT-005 - งานทรายล้าง
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-EXT-005', 'งานทรายล้าง', 'แบบฟอร์มตรวจสอบ QC งานทรายล้าง (ลำดับที่ 63 จากมาตรฐานโครงการ)', 'งานภายนอก', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'กรีดร่อง ตรง ไม่คด ไม่พริ้ว',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'สีของทรายล้าง ถูกต้องตามแบบ ไม่มีสีด่าง',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'ผิวเรียบ ไม่มีรอยบุ๋มหรือหลุมยุบ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'ไม่มีปูนเลอะพื้นบริเวณรอบๆหรือในร่องพลาสติก',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'ทำวคามสะอาดเศษวัสดุและฝุ่นจากการทำงานให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #64: QC-ARC-031 - งานทำความสะอาดบ้าน
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-031', 'งานทำความสะอาดบ้าน', 'แบบฟอร์มตรวจสอบ QC งานทำความสะอาดบ้าน (ลำดับที่ 64 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'พื้นบ้านไม่มีเศษฝุ่น เศษวัสดุจากการเก็บงาน',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'อุปกรณ์ไฟฟ้าไม่มีสี/ซิลิโคนเลอะ กระจกใสสะอาด เฟรมกระจกไม่มีสีติด',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'ห้องน้ำล้างสะอาด ไม่มีเศษฝุ่น/เศษวัสดุ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'ร่องกระจก/ร่องประตูอลุมิเนียมไม่มีเศษฝุ่นด้านในราง',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'ระเบียงชั้น 2 / ระเบียงหน้าบ้าน+หลังบ้าน ทำความสะอาดเรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 6, 'การตรวจสอบทั่วไป', 'Q06', 'ตรวจสอบว่าไม่มีอุปกรณ์หรือวัสดุหลงเหลืออยู่ในห้องเก็บของหรือในตัวบ้าน',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #65: QC-SAN-009 - งานติดตั้งอ่างล้างจาน
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-SAN-009', 'งานติดตั้งอ่างล้างจาน', 'แบบฟอร์มตรวจสอบ QC งานติดตั้งอ่างล้างจาน (ลำดับที่ 65 จากมาตรฐานโครงการ)', 'งานระบบสุขาภิบาล', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'อุปกรณ์สุขภัณฑ์ สายน้ำดี มินิบอลวาล์ว ตรงตาม Spec ไม่ใช้ของเก่า ติดตั้งตรงตำแหน่งในแบบ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'การเดินท่อ การต่อท่อกับอุปกรณ์ มั่นคงไม่มีน้ำหยด แน่นทุกจุด',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'เช็ดคราบซิลิโคนอ่างล้างหน้า ให้หมด',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'เช็คระบบน้ำดี และน้ำเสียทั้งหมด ไม่มีจุดรั่วซึม และตัน',
        '', 'pass_fail_na', true, true, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'ทำวคามสะอาดเศษวัสดุและฝุ่นจากการทำงานให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #66: QC-ARC-032 - งานติดตั้งฮู้ด+เตา
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-032', 'งานติดตั้งฮู้ด+เตา', 'แบบฟอร์มตรวจสอบ QC งานติดตั้งฮู้ด+เตา (ลำดับที่ 66 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ฮู้ดดูดควันได้ระดับได้อิ่ง ไม่เอียง ไม่มีสายไฟออกนอกตัว',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'เอาแก๊สแน่นได้ระดับ ไม่สั่นคลอน พร้อมนำแบตเตอรี่ ส่งให้ฝ่ายก่อสร้าง',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #67: QC-ARC-033 - งานกระจก
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-033', 'งานกระจก', 'แบบฟอร์มตรวจสอบ QC งานกระจก (ลำดับที่ 67 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'กระจกติดตั้งได้ระดับไม่เอียง ยึดแน่นมั่นคงไม่สั่นคลอน',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'กระจกไม่มีรอยขีดข่วน หรือ รอยเปื้อน รอยร้าว',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'ติดตั้งยางซีลครบถ้วนทุกจุด',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #68: QC-ARC-034 - งานเก็บรายละเอียดสี
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-034', 'งานเก็บรายละเอียดสี', 'แบบฟอร์มตรวจสอบ QC งานเก็บรายละเอียดสี (ลำดับที่ 68 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ตีนผนังหรือรอยเปื้อนตามผนังต้องเก็บสีให้หมด',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'สีไม่เป็นเม็ดทรายหยาบ ไม่เป็นคลื่นไม่เป็นตามด',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'เก็บสีภายนอกหลังจากปูหญ้า',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'เก็บรอยร้าวผนังด้วย รูฟชีลให้เรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'รอยต่อระหว่างวัสดุเนียนตา เช่น รอยต่อเหล็กและปูนผนัง ต้องไม่เลอะหากัน',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 6, 'การตรวจสอบทั่วไป', 'Q06', 'ต้องไม่มีสีเลอะ อุปกรณ์ไฟฟ้า สุขภัณฑ์ ประตู-หน้าต่าง และ พื้น',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #69: QC-ARC-035 - งานทำความสะอาดบ้าน 2
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-ARC-035', 'งานทำความสะอาดบ้าน 2', 'แบบฟอร์มตรวจสอบ QC งานทำความสะอาดบ้าน 2 (ลำดับที่ 69 จากมาตรฐานโครงการ)', 'งานสถาปัตย์', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'พื้นบ้านไม่มีเศษฝุ่น เศษวัสดุจากการเก็บงาน',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'อุปกรณ์ไฟฟ้าไม่มีสี/ซิลิโคนเลอะ กระจกใสสะอาด เฟรมกระจกไม่มีสีติด',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'ห้องน้ำล้างสะอาด ไม่มีเศษฝุ่น/เศษวัสดุ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 4, 'การตรวจสอบทั่วไป', 'Q04', 'ร่องกระจก/ร่องประตูอลุมิเนียมไม่มีเศษฝุ่นด้านในราง',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 5, 'การตรวจสอบทั่วไป', 'Q05', 'ระเบียงชั้น 2 / ระเบียงหน้าบ้าน+หลังบ้าน ทำความสะอาดเรียบร้อย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 6, 'การตรวจสอบทั่วไป', 'Q06', 'ตรวจสอบว่าไม่มีอุปกรณ์หรือวัสดุหลงเหลืออยู่ในห้องเก็บของหรือในตัวบ้าน',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


    -- Form #70: QC-EXT-006 - งานปูหญ้า
    INSERT INTO qc_form_templates (code, title, description, category, version, status, created_by)
    VALUES ('QC-EXT-006', 'งานปูหญ้า', 'แบบฟอร์มตรวจสอบ QC งานปูหญ้า (ลำดับที่ 70 จากมาตรฐานโครงการ)', 'งานภายนอก', 1, 'published', 'system_import')
    ON CONFLICT (code, version) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        status = 'published'
    RETURNING id INTO v_template_id;

    DELETE FROM qc_form_items WHERE form_template_id = v_template_id;

    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 1, 'การตรวจสอบทั่วไป', 'Q01', 'ปูหญ้าเต็มพื้นที่ ไม่เห็นส่วนของดินด้านใต้',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 2, 'การตรวจสอบทั่วไป', 'Q02', 'หญ้าเรียบได้ระดับ ไม่เป็นหลุมเป็นบ่อ',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );
    INSERT INTO qc_form_items (
        form_template_id, item_order, section_title, item_code, item_text,
        description, item_type, is_required, is_critical, require_remark_on_fail,
        require_photo_on_fail, unit, target_value, min_value, max_value, options
    ) VALUES (
        v_template_id, 3, 'การตรวจสอบทั่วไป', 'Q03', 'หญ้าเขียวดี ไม่เหลือง ไม่แห้งตาย',
        '', 'pass_fail_na', true, false, true,
        false, NULL, NULL, NULL, NULL, '[]'::jsonb
    );


END $$;
