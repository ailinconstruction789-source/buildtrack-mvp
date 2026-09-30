// Versioned evidence template. Labels are snapshots, never supplied by a caller.
export const VISIT_SOP_TEMPLATE_VERSION = 'house_visit_v1';
export const VISIT_SOP_TEMPLATE = {
  stage_a: [
    ['check_sample_house', 'ตรวจบ้านตัวอย่าง / บ้านที่จะพาชม'],
    ['turn_on_lights', 'เปิดไฟทุกจุดสำคัญ'],
    ['turn_on_ac', 'เปิดแอร์ / ระบายอากาศล่วงหน้า'],
    ['check_toilet', 'เช็กห้องน้ำ (แห้ง สะอาด กลิ่นหอม)'],
    ['check_cleanliness', 'เช็กฝุ่นและความสะอาดทั่วไป'],
    ['arrange_furniture', 'จัดระเบียบเฟอร์นิเจอร์และพร็อพ'],
    ['prepare_drinking_water', 'เตรียมน้ำดื่ม / เครื่องดื่มต้อนรับ'],
    ['buddha_water_sop', 'ถวายน้ำพระ / ตรวจพื้นที่พระตาม SOP บริษัท'],
    ['prepare_golf_cart', 'เตรียมรถกอล์ฟ (ทำความสะอาดเบาะ)'],
    ['check_golf_cart_battery', 'ตรวจระดับแบตเตอรี่รถกอล์ฟ'],
    ['check_tour_route', 'เช็กเส้นทางที่จะพาชม (ไม่มีสิ่งกีดขวาง)'],
    ['prepare_price_list', 'เตรียม Price List ล่าสุด'],
    ['prepare_stock_list', 'เตรียม Stock List / แปลงว่างล่าสุด'],
    ['prepare_layout', 'เตรียม Layout & Floor Plan แบบบ้าน'],
    ['check_promotions', 'ตรวจโปรโมชั่น / ของแถมแคมเปญล่าสุด'],
    ['check_loan_info', 'ตรวจข้อมูลสินเชื่อเบื้องต้น / ดอกเบี้ยธนาคาร'],
  ],
  stage_c: [
    ['turn_off_lights', 'ปิดไฟทุกจุด'],
    ['turn_off_ac', 'ปิดแอร์'],
    ['turn_off_water', 'ปิดน้ำ / ตรวจก๊อกน้ำ'],
    ['check_doors_windows', 'ตรวจประตูดิจิทัล & ล็อกหน้าต่างทุกบาน'],
    ['collect_documents', 'เก็บเอกสารและแผ่นพับเข้าที่'],
    ['reset_house_condition', 'เก็บบ้านและเฟอร์นิเจอร์กลับสภาพเดิม'],
    ['return_golf_cart', 'นำรถกอล์ฟคืนจุดจอดและเสียบชาร์จ'],
    ['record_customer_feedback', 'บันทึกความคิดเห็นลูกค้า'],
    ['record_interested_plot', 'บันทึกแปลงที่ลูกค้าสนใจ'],
    ['record_objections', 'บันทึกข้อกังวลของลูกค้า'],
    ['review_lead_stage', 'ทบทวนสถานะการติดตามลูกค้า'],
    ['set_next_action', 'ตรวจงานติดตามครั้งถัดไป'],
    ['set_next_follow_up', 'ตรวจวันเวลาติดตามครั้งถัดไป'],
  ],
} as const;
export type VisitSopItemStage = keyof typeof VISIT_SOP_TEMPLATE;
