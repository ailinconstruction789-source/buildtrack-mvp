/** Same questions as CustomerVoicesModal; intentionally no initial answers. */
export const CUSTOMER_VOICES_FORM_VERSION = 'customer_voices_v1';
export const VOICE_SCORES = [
  ['score_knowledge', 'พนักงานให้ความรู้ ข้อมูลครบถ้วน'],
  ['score_problem_solving', 'แก้ปัญหา/ตอบข้อสงสัยรวดเร็ว'],
  ['score_service_mind', 'บริการด้วยความเต็มใจ สุภาพ'],
  ['score_appearance', 'พนักงานแต่งกายเรียบร้อย บุคลิกภาพดี'],
  ['score_cleanliness', 'สิ่งแวดล้อมโครงการ/บ้านตัวอย่างสะอาด'],
  ['score_house_design', 'แบบบ้านและฟังก์ชันตรงใจ'],
  ['score_price', 'ราคาและงวดผ่อนตรงใจ'],
  ['score_location', 'ทำเลและโลเคชั่นตรงใจ'],
] as const;
export const VOICE_OPTIONAL_TEXT = [
  ['nickname', 'ชื่อเล่น'], ['line_id', 'ID Line'], ['age', 'อายุ'], ['gender', 'เพศ'],
  ['marital_status', 'สถานภาพ'], ['occupation', 'อาชีพ'], ['monthly_income', 'รายได้ต่อเดือน'],
  ['family_members', 'สมาชิกในครอบครัว'], ['previous_residence', 'ที่อยู่อาศัยเดิม'],
  ['reason_other', 'เหตุผลอื่น ๆ ที่เข้าชม'], ['source_other', 'แหล่งข้อมูลอื่น ๆ'],
] as const;
export const VOICE_CHOICES = {
  purpose: [
    ['purpose_relocate', 'ย้ายที่อยู่อาศัยใหม่'], ['purpose_family_expansion', 'รองรับครอบครัวขยาย/แต่งงาน'],
    ['purpose_independence', 'ต้องการความอิสระ / เป็นส่วนตัว'], ['purpose_rent_to_own', 'เปลี่ยนค่าเช่ามาเป็นเงินผ่อนบ้าน'],
    ['purpose_debt_consolidation', 'รวมหนี้เป็นก้อนเดียว (ปิดภาระหนี้)'],
  ],
  reason: [
    ['reason_price', 'ราคาเหมาะสม คุ้มค่า'], ['reason_location', 'ทำเลที่ตั้ง เดินทางสะดวก'],
    ['reason_promotion', 'โปรโมชั่นและข้อเสนอถูกใจ'], ['reason_design', 'ดีไซน์และการตกแต่งสวยงาม'],
    ['reason_house_type', 'แบบบ้านและขนาดที่ดินตรงความต้องการ'],
  ],
  source: [
    ['source_facebook', 'Facebook Ads / เพจ'], ['source_tiktok', 'TikTok'],
    ['source_youtube', 'YouTube'], ['source_billboard', 'ป้ายโฆษณาหน้าโครงการ'],
  ],
} as const;
export type VoiceScoreKey = typeof VOICE_SCORES[number][0];
export type VoiceTextKey = typeof VOICE_OPTIONAL_TEXT[number][0];
export type VoiceChoiceKey = typeof VOICE_CHOICES[keyof typeof VOICE_CHOICES][number][0];
export type VoiceAnswers = Record<VoiceScoreKey, number> & Partial<Record<VoiceTextKey, string> & Record<VoiceChoiceKey, boolean> & { monthly_rent: number }>;
