export function isURL(input) {
    try {
        new URL(input);
        return true;
    } catch (e) {
        if (typeof input === 'string' && (input.startsWith('http://') || input.startsWith('https://'))) {
            return true;
        }
        return false;
    }
}
