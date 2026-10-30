const escapeHtml = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function formatPanelHeading(panel) {
    if (!panel?.text || panel.preserveHeading) return panel;
    const html = panel.parseMode === 'HTML';
    const [first, ...rest] = panel.text.split('\n');
    const title = first.replace(/<[^>]*>/g, '');
    const emoji = /^\p{Extended_Pictographic}/u.test(title) ? ''
        : /manager|contact|lead card/i.test(title) ? '👤 '
        : /search/i.test(title) ? '🔎 '
        : /setting|calendar connect/i.test(title) ? '⚙️ '
        : /book|meeting|hand off/i.test(title) ? '📅 '
        : /add|edit|field|detail/i.test(title) ? '✏️ '
        : '📋 ';
    const heading = html ? first.replace(/^<b>(.*)<\/b>$/, '$1') : escapeHtml(first);
    return {...panel, parseMode: 'HTML', text: `<b>${emoji}${heading}</b>`
        + (rest.length ? '\n' + (html ? rest.join('\n') : escapeHtml(rest.join('\n'))) : '')};
}
