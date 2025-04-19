export const PLUGIN = {
    name: "Google Translate",
    maxTextLength: 1000,
    separator: "</p>",
    maxParallelWorkers: Infinity,
    sleepAfterMs: 300,
    strategy: googleTranslate,
}

const TOKEN = "AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520";

async function googleTranslate(text, from, to) {
    const apiUrl = "https://translate-pa.googleapis.com/v1/translateHtml";
    const body = JSON.stringify([[[text], from, to], "wt_lib"]);

    try {
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json+protobuf",
                "x-goog-api-key": TOKEN,
            },
            body: body,
        });

        if (!response.ok) {
            let errorBody = `Translation request failed with status ${response.status}`;
            try {
                const errorJson = await response.json();
                errorBody = errorJson?.error?.message || JSON.stringify(errorJson);
            } catch (e) {
                try {
                    errorBody = await response.text();
                } catch (textError) {
                    errorBody = `Translation request failed with status ${response.status} and could not read error body.`;
                }
            }
            console.error("Google API Error Response Body:", errorBody);
            throw new Error(`HTTP error ${response.status}: ${errorBody}`);
        }

        const json = await response.json();
        const decodedTranslation = json?.[0]?.[0];


        if (decodedTranslation === undefined || decodedTranslation === null) {
            console.warn("Google API Response (unexpected structure):", json);
            throw new Error("Got undefined or null translation result from Google API (unexpected response structure)");
        }

        return decodedTranslation;

    } catch (error) {
        console.error("Google Translate fetch/processing error:", error);
        throw new Error(`Google Translate failed: ${error.message}`);
    }
}
