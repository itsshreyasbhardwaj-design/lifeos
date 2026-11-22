/**
 * Interface strings for navigation and the core capture → review → remind →
 * complete workflow, in English, Hindi and Bengali.
 *
 * The Hindi and Bengali strings were written for this build and have NOT been
 * reviewed by native speakers yet (see docs/KNOWN_ISSUES.md). Screens outside
 * the core workflow are English-only in this version.
 */
const en = {
  'nav.today': 'Today', 'nav.inbox': 'Inbox', 'nav.calendar': 'Calendar', 'nav.search': 'Search',
  'nav.tasks': 'Tasks', 'nav.promises': 'Promises', 'nav.events': 'Life Events', 'nav.admin': 'LifeAdmin', 'nav.vault': 'Documents',
  'nav.purchases': 'Purchases', 'nav.subscriptions': 'Subscriptions', 'nav.bills': 'Bills', 'nav.routines': 'Routines',
  'nav.family': 'Family', 'nav.ai': 'Life AI', 'nav.graph': 'LifeGraph', 'nav.briefings': 'Briefings',
  'nav.settings': 'Settings', 'nav.privacy': 'Privacy', 'nav.billing': 'Subscription',
  'nav.group.primary': 'Primary', 'nav.group.organize': 'Organize', 'nav.group.shared': 'Shared', 'nav.group.intelligence': 'Intelligence', 'nav.group.account': 'Account',
  'capture.button': 'Capture', 'capture.title': 'Capture something', 'capture.text': 'Text', 'capture.link': 'Link', 'capture.files': 'Files', 'capture.voice': 'Voice note',
  'capture.placeholder': 'Paste a message, type a note, or describe what you need to remember…', 'capture.drop': 'Drop screenshots, receipts or PDFs here, or choose files',
  'capture.save': 'Save to Inbox', 'capture.saving': 'Saving…', 'capture.sourceDate': 'Date on the original (optional)', 'capture.offlineSaved': 'Saved offline. It will sync when you are back online.',
  'review.title': 'Review suggestions', 'review.confirm': 'Confirm', 'review.dismiss': 'Dismiss', 'review.checkThis': 'Check this', 'review.source': 'From the original',
  'review.remind': 'Remind me', 'review.chooseYear': 'Choose the year', 'review.nothing': 'Nothing was suggested from this capture.', 'review.addOwn': 'Add your own',
  'review.confirmed': 'Saved', 'review.processing': 'Reading your capture…',
  'today.greeting.morning': 'Good morning', 'today.greeting.afternoon': 'Good afternoon', 'today.greeting.evening': 'Good evening',
  'today.due': 'Due and overdue', 'today.schedule': 'Today', 'today.review': 'Needs review', 'today.waiting': 'Waiting on', 'today.assigned': 'Assigned to you', 'today.suggestions': 'Suggested next steps',
  'today.allClear': 'Nothing due. Capture something you don’t want to forget.',
  'task.complete': 'Mark complete', 'task.reopen': 'Reopen', 'task.quickAdd': 'Add a task — try “Pay rent on the 5th of every month”',
  'common.save': 'Save', 'common.cancel': 'Cancel', 'common.delete': 'Delete', 'common.edit': 'Edit', 'common.add': 'Add', 'common.loading': 'Loading…', 'common.offline': 'You are offline',
  'common.signOut': 'Sign out', 'common.space': 'Space',
};

type Messages = typeof en;
export type MessageKey = keyof Messages;

const hi: Messages = {
  'nav.today': 'आज', 'nav.inbox': 'इनबॉक्स', 'nav.calendar': 'कैलेंडर', 'nav.search': 'खोजें',
  'nav.tasks': 'काम', 'nav.promises': 'वादे', 'nav.events': 'जीवन के अवसर', 'nav.admin': 'कागज़ी काम', 'nav.vault': 'दस्तावेज़',
  'nav.purchases': 'ख़रीदारी', 'nav.subscriptions': 'सब्सक्रिप्शन', 'nav.bills': 'बिल', 'nav.routines': 'दिनचर्या',
  'nav.family': 'परिवार', 'nav.ai': 'लाइफ़ AI', 'nav.graph': 'लाइफ़ग्राफ़', 'nav.briefings': 'सारांश',
  'nav.settings': 'सेटिंग्स', 'nav.privacy': 'गोपनीयता', 'nav.billing': 'प्लान',
  'nav.group.primary': 'मुख्य', 'nav.group.organize': 'व्यवस्थित करें', 'nav.group.shared': 'साझा', 'nav.group.intelligence': 'समझ', 'nav.group.account': 'खाता',
  'capture.button': 'सहेजें', 'capture.title': 'कुछ सहेजें', 'capture.text': 'टेक्स्ट', 'capture.link': 'लिंक', 'capture.files': 'फ़ाइलें', 'capture.voice': 'आवाज़ नोट',
  'capture.placeholder': 'कोई संदेश चिपकाएँ, नोट लिखें, या जो याद रखना है वह बताएँ…', 'capture.drop': 'स्क्रीनशॉट, रसीदें या PDF यहाँ छोड़ें, या फ़ाइलें चुनें',
  'capture.save': 'इनबॉक्स में सहेजें', 'capture.saving': 'सहेजा जा रहा है…', 'capture.sourceDate': 'मूल पर लिखी तारीख़ (वैकल्पिक)', 'capture.offlineSaved': 'ऑफ़लाइन सहेजा गया। इंटरनेट आने पर सिंक होगा।',
  'review.title': 'सुझाव जाँचें', 'review.confirm': 'पक्का करें', 'review.dismiss': 'हटाएँ', 'review.checkThis': 'इसे जाँचें', 'review.source': 'मूल से',
  'review.remind': 'मुझे याद दिलाएँ', 'review.chooseYear': 'साल चुनें', 'review.nothing': 'इससे कोई सुझाव नहीं मिला।', 'review.addOwn': 'ख़ुद जोड़ें',
  'review.confirmed': 'सहेजा गया', 'review.processing': 'आपकी जानकारी पढ़ी जा रही है…',
  'today.greeting.morning': 'सुप्रभात', 'today.greeting.afternoon': 'नमस्कार', 'today.greeting.evening': 'शुभ संध्या',
  'today.due': 'आज और बकाया', 'today.schedule': 'आज', 'today.review': 'जाँचना बाकी', 'today.waiting': 'किसी का इंतज़ार', 'today.assigned': 'आपको सौंपे गए', 'today.suggestions': 'अगले सुझाए कदम',
  'today.allClear': 'आज कुछ बाकी नहीं। जो भूलना नहीं चाहते, उसे सहेज लें।',
  'task.complete': 'पूरा हुआ', 'task.reopen': 'फिर से खोलें', 'task.quickAdd': 'काम जोड़ें — जैसे “हर महीने की 5 तारीख़ को किराया देना”',
  'common.save': 'सहेजें', 'common.cancel': 'रद्द करें', 'common.delete': 'मिटाएँ', 'common.edit': 'बदलें', 'common.add': 'जोड़ें', 'common.loading': 'लोड हो रहा है…', 'common.offline': 'आप ऑफ़लाइन हैं',
  'common.signOut': 'साइन आउट', 'common.space': 'स्थान',
};

const bn: Messages = {
  'nav.today': 'আজ', 'nav.inbox': 'ইনবক্স', 'nav.calendar': 'ক্যালেন্ডার', 'nav.search': 'খুঁজুন',
  'nav.tasks': 'কাজ', 'nav.promises': 'প্রতিশ্রুতি', 'nav.events': 'জীবনের ঘটনা', 'nav.admin': 'কাগজপত্রের কাজ', 'nav.vault': 'নথিপত্র',
  'nav.purchases': 'কেনাকাটা', 'nav.subscriptions': 'সাবস্ক্রিপশন', 'nav.bills': 'বিল', 'nav.routines': 'রুটিন',
  'nav.family': 'পরিবার', 'nav.ai': 'লাইফ AI', 'nav.graph': 'লাইফগ্রাফ', 'nav.briefings': 'সারসংক্ষেপ',
  'nav.settings': 'সেটিংস', 'nav.privacy': 'গোপনীয়তা', 'nav.billing': 'প্ল্যান',
  'nav.group.primary': 'প্রধান', 'nav.group.organize': 'সাজান', 'nav.group.shared': 'যৌথ', 'nav.group.intelligence': 'বুদ্ধিমত্তা', 'nav.group.account': 'অ্যাকাউন্ট',
  'capture.button': 'সংরক্ষণ', 'capture.title': 'কিছু সংরক্ষণ করুন', 'capture.text': 'লেখা', 'capture.link': 'লিঙ্ক', 'capture.files': 'ফাইল', 'capture.voice': 'ভয়েস নোট',
  'capture.placeholder': 'একটি মেসেজ পেস্ট করুন, নোট লিখুন, বা যা মনে রাখতে চান তা লিখুন…', 'capture.drop': 'স্ক্রিনশট, রসিদ বা PDF এখানে ফেলুন, অথবা ফাইল বাছুন',
  'capture.save': 'ইনবক্সে রাখুন', 'capture.saving': 'সংরক্ষণ হচ্ছে…', 'capture.sourceDate': 'মূল নথির তারিখ (ঐচ্ছিক)', 'capture.offlineSaved': 'অফলাইনে রাখা হয়েছে। ইন্টারনেট এলে সিঙ্ক হবে।',
  'review.title': 'পরামর্শ যাচাই করুন', 'review.confirm': 'নিশ্চিত করুন', 'review.dismiss': 'বাদ দিন', 'review.checkThis': 'এটি দেখুন', 'review.source': 'মূল থেকে',
  'review.remind': 'মনে করিয়ে দিন', 'review.chooseYear': 'বছর বাছুন', 'review.nothing': 'এখান থেকে কোনো পরামর্শ পাওয়া যায়নি।', 'review.addOwn': 'নিজে যোগ করুন',
  'review.confirmed': 'সংরক্ষিত', 'review.processing': 'আপনার তথ্য পড়া হচ্ছে…',
  'today.greeting.morning': 'সুপ্রভাত', 'today.greeting.afternoon': 'নমস্কার', 'today.greeting.evening': 'শুভ সন্ধ্যা',
  'today.due': 'আজ ও বকেয়া', 'today.schedule': 'আজ', 'today.review': 'যাচাই বাকি', 'today.waiting': 'অপেক্ষায়', 'today.assigned': 'আপনাকে দেওয়া', 'today.suggestions': 'পরবর্তী প্রস্তাবিত পদক্ষেপ',
  'today.allClear': 'আজ কিছু বাকি নেই। যা ভুলতে চান না, তা সংরক্ষণ করুন।',
  'task.complete': 'সম্পন্ন', 'task.reopen': 'আবার খুলুন', 'task.quickAdd': 'কাজ যোগ করুন — যেমন “প্রতি মাসের ৫ তারিখে ভাড়া দেওয়া”',
  'common.save': 'সংরক্ষণ', 'common.cancel': 'বাতিল', 'common.delete': 'মুছুন', 'common.edit': 'সম্পাদনা', 'common.add': 'যোগ করুন', 'common.loading': 'লোড হচ্ছে…', 'common.offline': 'আপনি অফলাইনে আছেন',
  'common.signOut': 'সাইন আউট', 'common.space': 'স্থান',
};

const ALL: Record<string, Messages> = { en, hi, bn };

export function messages(locale: string): Messages {
  return ALL[locale.split('-')[0]!] ?? en;
}

export function t(locale: string) {
  const m = messages(locale);
  return (key: MessageKey) => m[key] ?? en[key];
}

export const LOCALES = [
  { id: 'en-IN', label: 'English (India)' },
  { id: 'hi-IN', label: 'हिन्दी' },
  { id: 'bn-IN', label: 'বাংলা' },
  { id: 'en-US', label: 'English (US)' },
  { id: 'en-GB', label: 'English (UK)' },
];
