// Main navigation. Booking tools are grouped inside Hand off lead.
export const MENU_SECTIONS = [
    { id: 'add-lead', command: 'add_lead', title: 'Add Lead', action: 'addflow' },
    { id: 'search-lead', command: 'search_lead', title: 'Search Lead', action: 'searchmenu' },
    { id: 'book-meeting', command: 'book_meeting', title: 'Hand off lead', action: 'bookingmenu' },
    { id: 'follow-up', command: 'follow_up', title: 'Follow-up Leads' },
    { id: 'onboarding', command: 'onboarding', title: 'Kick off Onboarding Chats', action: 'onboardingweb' },
    { id: 'dashboards', command: 'dashboards', title: 'Dashboards', action: 'dashboardweb' },
    { id: 'materials', command: 'materials', title: 'Materials' },
    { id: 'settings', command: 'settings', title: 'Settings' },
];

// Keep Telegram's command picker aligned with the inline main menu.
export const BOT_COMMANDS = [
    ...MENU_SECTIONS.map(({command, title}) => ({command, description: title})),
    {command: 'menu', description: 'Menu'},
];
