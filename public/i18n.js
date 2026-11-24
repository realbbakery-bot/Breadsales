// Shared helpers: translations (English + formal Arabic), formatting, API calls.

const STRINGS = {
  en: {
    // common
    lang_switch: 'العربية',
    loading: 'Loading…',
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
    delete: 'Delete',
    edit: 'Edit',
    add: 'Add',
    back: 'Back',
    yes: 'Yes',
    no: 'No',
    total: 'Total',
    items: 'items',
    item: 'item',
    pickup_date: 'Pickup date',
    notes: 'Notes',
    phone: 'Phone number',
    name: 'Your name',
    status_new: 'New',
    status_ready: 'Ready for pickup',
    status_completed: 'Picked up',
    status_cancelled: 'Cancelled',

    // shop
    menu_title: 'Available on this bake',
    sold_out: 'Sold out',
    left_n: '{n} left',
    only_n_left: 'Only {n} left!',
    max_n: 'Max {n} per order',
    add_to_order: 'Add',
    view_order: 'Review order',
    your_order: 'Your order',
    empty_cart: 'Your order is empty. Choose something delicious!',
    customer_details: 'Your details',
    name_ph: 'e.g. Sara Ahmed',
    phone_ph: 'e.g. 0551234567',
    notes_ph: 'Allergies, slicing preference, pickup time…',
    place_order: 'Reserve my order',
    placing: 'Reserving…',
    pay_note: 'No online payment — you pay on pickup.',
    shop_closed: 'We are not taking orders right now. Please check back soon!',
    no_products: 'Nothing on the menu yet. Please check back soon!',
    success_title: 'Your order is reserved!',
    success_body: 'Thank you, {name}. Please keep your order code:',
    success_pickup: 'Pickup on {date}',
    send_whatsapp: 'Send my order to the baker on WhatsApp',
    new_order: 'Place another order',
    track_title: 'Check my order',
    track_link: 'Already ordered? Check your order status',
    order_code: 'Order code',
    find_order: 'Find order',
    order_status: 'Status',
    wa_message: 'Hello! I just reserved order {code} for pickup on {date}:\n{lines}\nTotal: {total}\nName: {name}',

    // errors
    err_generic: 'Something went wrong. Please try again.',
    err_network: 'Could not reach the server. Check your connection.',
    err_shop_closed: 'Sorry, the bakery just stopped taking orders.',
    err_out_of_stock: 'Sorry, only {available} of “{item}” left. We updated your order.',
    err_product_unavailable: 'One of the items is no longer available. We updated your order.',
    err_over_max_per_order: 'You can order at most {max} of “{item}”.',
    err_invalid_name: 'Please enter your name.',
    err_invalid_phone: 'Please enter a valid phone number.',
    err_invalid_pickup_date: 'Please choose a pickup date within the allowed range.',
    err_empty_order: 'Your order is empty.',
    err_rate_limited: 'Too many attempts. Please wait a little and try again.',
    err_order_not_found: 'No order found with that code and phone number.',
    err_wrong_password: 'Incorrect password.',
    err_weak_password: 'Password must be at least 8 characters.',
    err_invalid_setup_code: 'The setup code is not correct.',
    err_name_required: 'Please enter a product name (English or Arabic).',
    err_invalid_price: 'Please enter a valid price.',
    err_invalid_number: 'Please enter a valid whole number.',
    err_invalid_whatsapp: 'Enter the WhatsApp number with country code, digits only.',
    err_invalid_image: 'That image could not be used. Try a JPG or PNG photo.',
    err_payload_too_large: 'That photo is too large.',
    err_cannot_cancel_completed: 'A picked-up order cannot be cancelled.',
    err_order_already_cancelled: 'This order is already cancelled.',
    err_unauthorized: 'Please log in again.',

    // admin
    admin_title: 'Baker dashboard',
    view_shop: 'View shop',
    logout: 'Log out',
    login_title: 'Welcome back, baker!',
    login_sub: 'Log in to manage your menu and orders.',
    password: 'Password',
    login: 'Log in',
    setup_title: 'Set up your bakery',
    setup_sub: 'Create a password for your dashboard. The setup code was printed in the server log when the app started.',
    setup_code: 'Setup code',
    new_password: 'New password (min. 8 characters)',
    create_password: 'Create password',
    tab_today: 'Bake sheet',
    tab_orders: 'Orders',
    tab_products: 'Menu',
    tab_settings: 'Settings',
    kpi_new: 'New orders',
    kpi_ready: 'Ready',
    kpi_done: 'Picked up',
    kpi_revenue: 'Expected sales',
    for_date: 'For',
    to_prepare: 'To hand over on this day',
    nothing_to_prepare: 'No open orders for this day.',
    low_stock: 'Running low',
    no_low_stock: 'All items have healthy stock.',
    pending_all: '{n} new order(s) waiting in total',
    filter_open: 'Open',
    filter_all: 'All',
    filter_any_date: 'Any date',
    no_orders: 'No orders here yet.',
    mark_ready: 'Mark ready',
    mark_completed: 'Picked up',
    cancel_order: 'Cancel order',
    confirm_cancel: 'Cancel this order? Its items will go back into stock.',
    whatsapp_customer: 'WhatsApp',
    call: 'Call',
    placed_at: 'Placed',
    add_product: 'Add item',
    edit_product: 'Edit item',
    new_product: 'New item',
    name_en: 'Name (English)',
    name_ar: 'Name (Arabic)',
    desc_en: 'Description (English)',
    desc_ar: 'Description (Arabic)',
    price: 'Price',
    stock: 'In stock',
    max_per_order: 'Max per order (optional)',
    emoji: 'Icon',
    photo: 'Photo',
    choose_photo: 'Choose photo',
    remove_photo: 'Remove photo',
    uploading: 'Uploading…',
    visible: 'Show on menu',
    hidden: 'Hidden',
    sort: 'Display order',
    confirm_delete: 'Delete this item permanently? Past orders keep their details.',
    no_products_admin: 'Your menu is empty. Add your first item!',
    set_stock: 'Set',
    saved: 'Saved ✓',
    shop_status: 'Taking orders',
    shop_open_on: 'Open — customers can order',
    shop_open_off: 'Closed — ordering is paused',
    s_identity: 'Bakery',
    s_ordering: 'Ordering',
    s_security: 'Security',
    shop_name_en: 'Bakery name (English)',
    shop_name_ar: 'Bakery name (Arabic)',
    tagline_en: 'Tagline (English)',
    tagline_ar: 'Tagline (Arabic)',
    pickup_info_en: 'Pickup instructions (English)',
    pickup_info_ar: 'Pickup instructions (Arabic)',
    currency_en: 'Currency (English)',
    currency_ar: 'Currency (Arabic)',
    decimals: 'Decimal places',
    whatsapp: 'Your WhatsApp number (with country code)',
    whatsapp_ph: 'e.g. 966551234567',
    country_code: 'Country calling code (for customer WhatsApp links)',
    lead_days: 'Earliest pickup (days from today)',
    max_days_ahead: 'Latest pickup (days from today)',
    current_password: 'Current password',
    change_password: 'Change password',
    share_link: 'Share this link with your customers:',
    copy: 'Copy',
    copied: 'Copied!',

    // bake days
    choose_bake_day: 'Choose your bake day',
    orders_close: 'Orders close {when}',
    no_bake_days: 'No bake is open for orders right now. Please check back soon!',
    bake_day_label: 'Bake day',
    err_orders_closed_for_day: 'Orders for this bake day have just closed.',
    err_bake_day_unavailable: 'This bake day is no longer available.',
    err_bake_day_not_found: 'This bake day is no longer available.',
    err_capacity_below_reserved: '{reserved} of “{item}” are already reserved, so the quantity cannot be lower.',
    err_bake_day_exists: 'There is already a bake day on that date.',
    err_bake_day_has_orders: 'This bake day has orders, so it cannot be moved or deleted. Pause it instead.',
    err_invalid_date: 'Please choose a valid date.',
    err_invalid_cutoff: 'Please enter a valid closing time.',
    err_cutoff_after_bake_day: 'Orders must close before the end of the bake day.',
    err_invalid_time: 'Please enter a valid time.',
    tab_bake_days: 'Bake days',
    new_bake_day: 'Plan a bake day',
    edit_bake_day: 'Edit bake day',
    bake_date: 'Bake & pickup date',
    cutoff: 'Orders close at',
    cutoff_hint: 'Leave empty to accept orders until the bake day itself.',
    note_en: 'Note for customers (English)',
    note_ar: 'Note for customers (Arabic)',
    how_many: 'How many will you bake?',
    open_for_orders: 'Open for orders',
    state_open: 'Taking orders',
    state_cutoff: 'Orders closed',
    state_closed: 'Paused',
    state_past: 'Done',
    reserved_of: '{r} / {c} reserved',
    to_bake: 'To bake',
    bake_left: 'left',
    no_bake_days_admin: 'No bake days planned. Plan your next bake!',
    show_past: 'Show past bakes',
    show_upcoming: 'Show upcoming',
    default_qty: 'Usual quantity per bake',
    cutoff_days_before: 'Close orders this many days before',
    cutoff_time: 'Closing time',
    s_bake_defaults: 'New bake day defaults',
    orders_n: '{n} orders',
    all_bake_days: 'All bake days',
    prefilled_hint: 'Pre-filled from your last bake. Adjust and save.',
    no_products_for_bake: 'Add items to your menu first, then plan a bake day.',
    not_on_bake: 'Not baking',
    confirm_delete_day: 'Delete this bake day?',

    // recipes & production
    tab_production: 'Production',
    unit_g: 'g',
    export_data: 'Download my data',
    recipe: 'Recipe',
    add_recipe: 'Add recipe',
    edit_recipe: 'Recipe & baker\'s math',
    piece_weight_g: 'Dough weight per piece (g)',
    waste_pct: 'Dough loss (%)',
    levain_hydration: 'Levain hydration (%)',
    ingredients: 'Ingredients (baker\'s %)',
    kind_flour: 'Flour',
    kind_water: 'Water',
    kind_levain: 'Levain',
    kind_salt: 'Salt',
    kind_yeast: 'Yeast',
    kind_other: 'Other',
    ing_name_en: 'Name (English)',
    ing_name_ar: 'Name (Arabic)',
    add_ingredient: '+ Add ingredient',
    remove: 'Remove',
    flour_total_bad: 'Flours add up to {n}% — they must total 100%.',
    flour_total_ok: 'Flours add up to 100% ✓',
    hydration_line: 'Hydration {f}% · overall {o}% including levain · {p}% prefermented flour',
    try_batch: 'Try it — loaves:',
    total_dough: 'Total dough',
    recipe_notes_en: 'Method notes (English)',
    recipe_notes_ar: 'Method notes (Arabic)',
    delete_recipe: 'Remove recipe',
    confirm_delete_recipe: 'Remove this recipe?',
    math_explainer: 'Each ingredient is a percentage of the total flour, and the flours add up to 100%. The levain\'s own flour and water count toward the overall hydration.',
    err_flour_must_total_100: 'The flours must add up to 100% (now {total}%).',
    err_invalid_recipe: 'Please check the recipe ingredients.',
    err_ingredient_name_required: 'Every ingredient needs a name.',
    err_recipe_not_found: 'This item has no recipe yet.',
    prod_intro: 'Plan the loaves for this bake and check the dough. Then publish the loaves as the quantities customers can order.',
    use_planned: 'Use current quantities',
    use_orders: 'Use orders + extra',
    extra: 'Extra per bread',
    loaves: 'Loaves',
    reserved_n: '{n} reserved',
    no_recipe: 'No recipe yet',
    apply_capacity: 'Apply as available quantities',
    applied: 'Available quantities updated ✓',
    weighing_list: 'Weighing list for this bake',
    levain_to_build: 'Levain to build',
    levain_split: '{flour} g flour + {water} g water, plus your starter',
    print: 'Print',
    dough_for: '{n} × {w} g',
    no_production: 'Plan a bake day first, then calculate its dough here.',
    mix_after_cutoff: 'Orders are closed for this bake. Mix for the orders, plus a few extras.',
  },

  ar: {
    lang_switch: 'English',
    loading: 'جارٍ التحميل…',
    save: 'حفظ',
    cancel: 'إلغاء',
    close: 'إغلاق',
    delete: 'حذف',
    edit: 'تعديل',
    add: 'إضافة',
    back: 'رجوع',
    yes: 'نعم',
    no: 'لا',
    total: 'الإجمالي',
    items: 'أصناف',
    item: 'صنف',
    pickup_date: 'تاريخ الاستلام',
    notes: 'ملاحظات',
    phone: 'رقم الهاتف',
    name: 'الاسم',
    status_new: 'جديد',
    status_ready: 'جاهز للاستلام',
    status_completed: 'تم الاستلام',
    status_cancelled: 'ملغى',

    menu_title: 'المتاح في هذه الخَبزة',
    sold_out: 'نفدت الكمية',
    left_n: 'المتبقي {n}',
    only_n_left: 'لم يتبقَّ سوى {n}!',
    max_n: 'الحد الأقصى {n} للطلب الواحد',
    add_to_order: 'أضف',
    view_order: 'مراجعة الطلب',
    your_order: 'طلبك',
    empty_cart: 'طلبك فارغ. اختر ما يطيب لك!',
    customer_details: 'بياناتك',
    name_ph: 'مثال: سارة أحمد',
    phone_ph: 'مثال: 0551234567',
    notes_ph: 'الحساسية الغذائية، تفضيل التقطيع، وقت الاستلام…',
    place_order: 'احجز طلبي',
    placing: 'جارٍ الحجز…',
    pay_note: 'لا يوجد دفع إلكتروني — يُسدَّد المبلغ عند الاستلام.',
    shop_closed: 'لا نستقبل الطلبات حاليًا. يُرجى المحاولة لاحقًا.',
    no_products: 'لا توجد أصناف في القائمة بعد. يُرجى العودة قريبًا.',
    success_title: 'تم حجز طلبك بنجاح!',
    success_body: 'شكرًا لك يا {name}. يُرجى الاحتفاظ برمز الطلب:',
    success_pickup: 'الاستلام بتاريخ {date}',
    send_whatsapp: 'أرسل طلبي إلى الخبّاز عبر واتساب',
    new_order: 'طلب جديد',
    track_title: 'الاستعلام عن طلبي',
    track_link: 'هل طلبت من قبل؟ استعلم عن حالة طلبك',
    order_code: 'رمز الطلب',
    find_order: 'بحث',
    order_status: 'الحالة',
    wa_message: 'السلام عليكم، لقد حجزت الطلب رقم {code} للاستلام بتاريخ {date}:\n{lines}\nالإجمالي: {total}\nالاسم: {name}',

    err_generic: 'حدث خطأ ما. يُرجى المحاولة مرة أخرى.',
    err_network: 'تعذّر الاتصال بالخادم. يُرجى التحقق من الاتصال.',
    err_shop_closed: 'نعتذر، توقّف المخبز عن استقبال الطلبات للتو.',
    err_out_of_stock: 'نعتذر، لم يتبقَّ من «{item}» سوى {available}. تم تحديث طلبك.',
    err_product_unavailable: 'أحد الأصناف لم يعد متاحًا. تم تحديث طلبك.',
    err_over_max_per_order: 'الحد الأقصى من «{item}» هو {max} للطلب الواحد.',
    err_invalid_name: 'يُرجى إدخال الاسم.',
    err_invalid_phone: 'يُرجى إدخال رقم هاتف صحيح.',
    err_invalid_pickup_date: 'يُرجى اختيار تاريخ استلام ضمن المدة المتاحة.',
    err_empty_order: 'طلبك فارغ.',
    err_rate_limited: 'محاولات كثيرة. يُرجى الانتظار قليلًا ثم المحاولة مجددًا.',
    err_order_not_found: 'لم يُعثر على طلب بهذا الرمز ورقم الهاتف.',
    err_wrong_password: 'كلمة المرور غير صحيحة.',
    err_weak_password: 'يجب ألا تقل كلمة المرور عن ٨ أحرف.',
    err_invalid_setup_code: 'رمز الإعداد غير صحيح.',
    err_name_required: 'يُرجى إدخال اسم الصنف (بالعربية أو الإنجليزية).',
    err_invalid_price: 'يُرجى إدخال سعر صحيح.',
    err_invalid_number: 'يُرجى إدخال عدد صحيح.',
    err_invalid_whatsapp: 'أدخل رقم واتساب مع رمز الدولة، أرقامًا فقط.',
    err_invalid_image: 'تعذّر استخدام هذه الصورة. جرّب صورة بصيغة JPG أو PNG.',
    err_payload_too_large: 'حجم الصورة كبير جدًا.',
    err_cannot_cancel_completed: 'لا يمكن إلغاء طلب تم استلامه.',
    err_order_already_cancelled: 'هذا الطلب ملغى مسبقًا.',
    err_unauthorized: 'يُرجى تسجيل الدخول مجددًا.',

    admin_title: 'لوحة الخبّاز',
    view_shop: 'عرض المتجر',
    logout: 'تسجيل الخروج',
    login_title: 'أهلًا بعودتك!',
    login_sub: 'سجّل الدخول لإدارة القائمة والطلبات.',
    password: 'كلمة المرور',
    login: 'دخول',
    setup_title: 'إعداد مخبزك',
    setup_sub: 'أنشئ كلمة مرور للوحة التحكم. رمز الإعداد مطبوع في سجل الخادم عند تشغيل التطبيق.',
    setup_code: 'رمز الإعداد',
    new_password: 'كلمة مرور جديدة (٨ أحرف على الأقل)',
    create_password: 'إنشاء كلمة المرور',
    tab_today: 'جدول الخَبز',
    tab_orders: 'الطلبات',
    tab_products: 'القائمة',
    tab_settings: 'الإعدادات',
    kpi_new: 'طلبات جديدة',
    kpi_ready: 'جاهزة',
    kpi_done: 'مُستلَمة',
    kpi_revenue: 'المبيعات المتوقعة',
    for_date: 'بتاريخ',
    to_prepare: 'المطلوب تسليمه في هذا اليوم',
    nothing_to_prepare: 'لا توجد طلبات مفتوحة لهذا اليوم.',
    low_stock: 'أصناف على وشك النفاد',
    no_low_stock: 'المخزون كافٍ لجميع الأصناف.',
    pending_all: 'إجمالي الطلبات الجديدة بانتظارك: {n}',
    filter_open: 'المفتوحة',
    filter_all: 'الكل',
    filter_any_date: 'كل التواريخ',
    no_orders: 'لا توجد طلبات هنا بعد.',
    mark_ready: 'جاهز',
    mark_completed: 'تم الاستلام',
    cancel_order: 'إلغاء الطلب',
    confirm_cancel: 'هل تريد إلغاء هذا الطلب؟ ستعود أصنافه إلى المخزون.',
    whatsapp_customer: 'واتساب',
    call: 'اتصال',
    placed_at: 'وقت الطلب',
    add_product: 'إضافة صنف',
    edit_product: 'تعديل الصنف',
    new_product: 'صنف جديد',
    name_en: 'الاسم (بالإنجليزية)',
    name_ar: 'الاسم (بالعربية)',
    desc_en: 'الوصف (بالإنجليزية)',
    desc_ar: 'الوصف (بالعربية)',
    price: 'السعر',
    stock: 'الكمية المتوفرة',
    max_per_order: 'الحد الأقصى للطلب الواحد (اختياري)',
    emoji: 'الأيقونة',
    photo: 'الصورة',
    choose_photo: 'اختيار صورة',
    remove_photo: 'إزالة الصورة',
    uploading: 'جارٍ الرفع…',
    visible: 'إظهار في القائمة',
    hidden: 'مخفي',
    sort: 'ترتيب العرض',
    confirm_delete: 'هل تريد حذف هذا الصنف نهائيًا؟ ستبقى تفاصيل الطلبات السابقة محفوظة.',
    no_products_admin: 'قائمتك فارغة. أضف صنفك الأول!',
    set_stock: 'تعيين',
    saved: 'تم الحفظ ✓',
    shop_status: 'استقبال الطلبات',
    shop_open_on: 'مفتوح — يمكن للعملاء الطلب',
    shop_open_off: 'مغلق — الطلبات متوقفة مؤقتًا',
    s_identity: 'المخبز',
    s_ordering: 'الطلبات',
    s_security: 'الأمان',
    shop_name_en: 'اسم المخبز (بالإنجليزية)',
    shop_name_ar: 'اسم المخبز (بالعربية)',
    tagline_en: 'العبارة التعريفية (بالإنجليزية)',
    tagline_ar: 'العبارة التعريفية (بالعربية)',
    pickup_info_en: 'تعليمات الاستلام (بالإنجليزية)',
    pickup_info_ar: 'تعليمات الاستلام (بالعربية)',
    currency_en: 'العملة (بالإنجليزية)',
    currency_ar: 'العملة (بالعربية)',
    decimals: 'عدد الخانات العشرية',
    whatsapp: 'رقم واتساب الخاص بك (مع رمز الدولة)',
    whatsapp_ph: 'مثال: 966551234567',
    country_code: 'رمز الاتصال الدولي (لروابط واتساب العملاء)',
    lead_days: 'أقرب موعد استلام (بالأيام من اليوم)',
    max_days_ahead: 'أبعد موعد استلام (بالأيام من اليوم)',
    current_password: 'كلمة المرور الحالية',
    change_password: 'تغيير كلمة المرور',
    share_link: 'شارك هذا الرابط مع عملائك:',
    copy: 'نسخ',
    copied: 'تم النسخ!',

    choose_bake_day: 'اختر يوم الخَبز',
    orders_close: 'آخر موعد للطلب {when}',
    no_bake_days: 'لا توجد خَبزة متاحة للطلب حاليًا. يُرجى العودة قريبًا.',
    bake_day_label: 'يوم الخَبز',
    err_orders_closed_for_day: 'أُغلق باب الطلب لهذا اليوم للتو.',
    err_bake_day_unavailable: 'يوم الخَبز هذا لم يعد متاحًا.',
    err_bake_day_not_found: 'يوم الخَبز هذا لم يعد متاحًا.',
    err_capacity_below_reserved: 'تم حجز {reserved} من «{item}» مسبقًا، ولا يمكن أن تقل الكمية عن ذلك.',
    err_bake_day_exists: 'يوجد يوم خَبز في هذا التاريخ مسبقًا.',
    err_bake_day_has_orders: 'لهذا اليوم طلبات، فلا يمكن نقله أو حذفه. يمكنك إيقافه مؤقتًا بدلًا من ذلك.',
    err_invalid_date: 'يُرجى اختيار تاريخ صحيح.',
    err_invalid_cutoff: 'يُرجى إدخال موعد إغلاق صحيح.',
    err_cutoff_after_bake_day: 'يجب أن يُغلق الطلب قبل نهاية يوم الخَبز.',
    err_invalid_time: 'يُرجى إدخال وقت صحيح.',
    tab_bake_days: 'أيام الخَبز',
    new_bake_day: 'خطّط يوم خَبز',
    edit_bake_day: 'تعديل يوم الخَبز',
    bake_date: 'تاريخ الخَبز والاستلام',
    cutoff: 'موعد إغلاق الطلبات',
    cutoff_hint: 'اتركه فارغًا لاستقبال الطلبات حتى يوم الخَبز نفسه.',
    note_en: 'ملاحظة للعملاء (بالإنجليزية)',
    note_ar: 'ملاحظة للعملاء (بالعربية)',
    how_many: 'كم ستخبز من كل صنف؟',
    open_for_orders: 'متاح للطلب',
    state_open: 'يستقبل الطلبات',
    state_cutoff: 'أُغلقت الطلبات',
    state_closed: 'متوقف مؤقتًا',
    state_past: 'منتهٍ',
    reserved_of: 'محجوز {r} من {c}',
    to_bake: 'المطلوب خَبزه',
    bake_left: 'متبقٍّ',
    no_bake_days_admin: 'لا توجد أيام خَبز مخطط لها. خطّط لخَبزتك القادمة!',
    show_past: 'عرض الخَبزات السابقة',
    show_upcoming: 'عرض القادمة',
    default_qty: 'الكمية المعتادة لكل خَبزة',
    cutoff_days_before: 'إغلاق الطلبات قبل يوم الخَبز بعدد أيام',
    cutoff_time: 'وقت الإغلاق',
    s_bake_defaults: 'الإعدادات الافتراضية ليوم الخَبز',
    orders_n: 'عدد الطلبات: {n}',
    all_bake_days: 'كل أيام الخَبز',
    prefilled_hint: 'تمت التعبئة من خَبزتك الأخيرة. عدّل ثم احفظ.',
    no_products_for_bake: 'أضف أصنافًا إلى قائمتك أولًا، ثم خطّط يوم الخَبز.',
    not_on_bake: 'لن يُخبز',
    confirm_delete_day: 'هل تريد حذف يوم الخَبز هذا؟',

    tab_production: 'الإنتاج',
    unit_g: 'غ',
    export_data: 'تنزيل بياناتي',
    recipe: 'الوصفة',
    add_recipe: 'إضافة وصفة',
    edit_recipe: 'الوصفة ونِسب الخبّاز',
    piece_weight_g: 'وزن العجين للقطعة الواحدة (غ)',
    waste_pct: 'فاقد العجين (٪)',
    levain_hydration: 'نسبة ترطيب الخميرة الطبيعية (٪)',
    ingredients: 'المكوّنات (نِسب الخبّاز ٪)',
    kind_flour: 'دقيق',
    kind_water: 'ماء',
    kind_levain: 'خميرة طبيعية',
    kind_salt: 'ملح',
    kind_yeast: 'خميرة',
    kind_other: 'أخرى',
    ing_name_en: 'الاسم (بالإنجليزية)',
    ing_name_ar: 'الاسم (بالعربية)',
    add_ingredient: '+ إضافة مكوّن',
    remove: 'إزالة',
    flour_total_bad: 'مجموع أنواع الدقيق {n}٪، ويجب أن يساوي ١٠٠٪.',
    flour_total_ok: 'مجموع أنواع الدقيق ١٠٠٪ ✓',
    hydration_line: 'الترطيب {f}٪ · الإجمالي مع الخميرة {o}٪ · الدقيق المخمّر مسبقًا {p}٪',
    try_batch: 'جرّب — عدد الأرغفة:',
    total_dough: 'إجمالي العجين',
    recipe_notes_en: 'ملاحظات الطريقة (بالإنجليزية)',
    recipe_notes_ar: 'ملاحظات الطريقة (بالعربية)',
    delete_recipe: 'إزالة الوصفة',
    confirm_delete_recipe: 'هل تريد إزالة هذه الوصفة؟',
    math_explainer: 'كل مكوّن نسبةٌ مئوية من إجمالي الدقيق، ومجموع أنواع الدقيق ١٠٠٪. ويُحتسب دقيق الخميرة الطبيعية وماؤها ضمن نسبة الترطيب الإجمالية.',
    err_flour_must_total_100: 'يجب أن يكون مجموع أنواع الدقيق ١٠٠٪ (المجموع الحالي {total}٪).',
    err_invalid_recipe: 'يُرجى مراجعة مكوّنات الوصفة.',
    err_ingredient_name_required: 'يجب أن يكون لكل مكوّن اسم.',
    err_recipe_not_found: 'لا توجد وصفة لهذا الصنف بعد.',
    prod_intro: 'خطّط عدد الأرغفة لهذه الخَبزة وراجع كميات العجين، ثم اعتمدها كمياتٍ متاحةً لطلب العملاء.',
    use_planned: 'استخدام الكميات الحالية',
    use_orders: 'الطلبات + كمية إضافية',
    extra: 'إضافي لكل صنف',
    loaves: 'الأرغفة',
    reserved_n: 'محجوز {n}',
    no_recipe: 'لا توجد وصفة بعد',
    apply_capacity: 'اعتماد ككميات متاحة',
    applied: 'تم تحديث الكميات المتاحة ✓',
    weighing_list: 'قائمة الأوزان لهذه الخَبزة',
    levain_to_build: 'الخميرة الطبيعية المطلوب تحضيرها',
    levain_split: '{flour} غ دقيق + {water} غ ماء، إضافةً إلى خميرتك الأم',
    print: 'طباعة',
    dough_for: '{n} × {w} غ',
    no_production: 'خطّط يوم خَبز أولًا، ثم احسب عجينه هنا.',
    mix_after_cutoff: 'أُغلقت الطلبات لهذه الخَبزة. اعجن بقدر الطلبات مع كمية إضافية قليلة.',
  },
};

function detectLang() {
  try {
    const saved = localStorage.getItem('bs_lang');
    if (saved === 'ar' || saved === 'en') return saved;
  } catch {}
  return (navigator.language || '').toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

export const i18n = {
  lang: detectLang(),
  listeners: [],
  t(key, vars = {}) {
    const s = STRINGS[this.lang][key] ?? STRINGS.en[key] ?? key;
    return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
  },
  setLang(lang) {
    this.lang = lang;
    try { localStorage.setItem('bs_lang', lang); } catch {}
    this.apply();
    this.listeners.forEach((fn) => fn(lang));
  },
  toggle() { this.setLang(this.lang === 'ar' ? 'en' : 'ar'); },
  onChange(fn) { this.listeners.push(fn); },
  apply() {
    document.documentElement.lang = this.lang;
    document.documentElement.dir = this.lang === 'ar' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = this.t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = this.t(el.dataset.i18nPh); });
  },
  // Pick the right-language field of a bilingual record, falling back to the other.
  pick(obj, base) {
    const other = this.lang === 'ar' ? 'en' : 'ar';
    return obj[`${base}_${this.lang}`] || obj[`${base}_${other}`] || '';
  },
};

export const t = (k, v) => i18n.t(k, v);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Western digits in both languages keep prices & phone numbers unambiguous.
export function money(amount, settings) {
  const dec = Number(settings?.decimals ?? 2);
  const n = Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const cur = i18n.pick(settings || {}, 'currency');
  return i18n.lang === 'ar' ? `${n} ${cur}` : `${cur} ${n}`;
}

export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const locale = i18n.lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB';
  return date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
}

export function formatCutoff(local) {
  if (!local) return '';
  const [d, tm] = local.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = tm.split(':').map(Number);
  const date = new Date(y, m - 1, day, hh, mm);
  const locale = i18n.lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB';
  return date.toLocaleString(locale, { weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function formatDateTime(sqlUtc) {
  if (!sqlUtc) return '';
  const date = new Date(sqlUtc.replace(' ', 'T') + 'Z');
  const locale = i18n.lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB';
  return date.toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export class ApiError extends Error {
  constructor(code, status, details) { super(code); this.code = code; this.status = status; this.details = details || {}; }
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('network', 0);
  }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new ApiError(data?.error || 'generic', res.status, data?.details);
  return data;
}

// Human message for an API error, in the current language.
export function errorText(err) {
  const code = err?.code || 'generic';
  const d = err?.details || {};
  const item = d.name_en || d.name_ar ? i18n.pick(d, 'name') : '';
  const key = `err_${code}`;
  return STRINGS.en[key] ? t(key, { ...d, item }) : t('err_generic');
}

export function toast(msg, kind = 'info') {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 3800);
}
