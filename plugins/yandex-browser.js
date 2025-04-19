export const PLUGIN = {
    name: "Yandex browser translate",
    maxTextLength: 3500,
    separator: "\n\n\n",
    maxParallelWorkers: 2,
    sleepAfterMs: 50,
    strategy: yandexTranslate,
}

const FILTER_PATTERN = /។|::|:;|;:| :/ug;

async function yandexTranslate(text, from, to) {
    const apiUrl = "https://browser.translate.yandex.net/api/v1/tr.json/translate";
    const params = new URLSearchParams({
        srv: "browser_video_translation",
        lang: `${from}-${to}`,
        text: text,
        format: "html",
        options: "1"
    });

    const fullUrl = `${apiUrl}?${params.toString()}`;

    try {
        const response = await fetch(fullUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json, text/javascript, */*; q=0.01"
            },
        });

        if (!response.ok) {
            let errorBody = "Translation request failed";
            try {
                const errorJson = await response.json();
                errorBody = errorJson?.message || JSON.stringify(errorJson);
            } catch (e) {
                errorBody = await response.text();
            }
            throw new Error(`HTTP error ${response.status}: ${errorBody}`);
        }

        const json = await response.json();

        if (json.code && json.code !== 200) {
            throw new Error(`Yandex API error ${json.code}: ${json.message || "Unknown Yandex API error"}`);
        }

        const result = json?.text?.[0];

        if (result === undefined || result === null) {
            console.warn("Yandex API Response:", json);
            throw new Error("Got undefined or null translation result from Yandex API");
        }

        const filteredResult = result.replace(FILTER_PATTERN, "");

        return filteredResult;

    } catch (error) {
        console.error("Yandex Translate fetch error:", error);
        throw new Error(`Yandex Translate failed: ${error.message}`);
    }
}
