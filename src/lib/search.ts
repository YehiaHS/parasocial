export interface SearchResult {
    title: string;
    link: string;
    snippet: string;
    source: string;
}

/**
 * Perform a real Wikipedia search using the MediaWiki API via Proxy.
 */
export async function searchWikipedia(query: string): Promise<SearchResult[]> {
    try {
        const params = new URLSearchParams({
            action: 'query',
            list: 'search',
            srsearch: query,
            format: 'json',
            origin: '*',
            srlimit: '3' // Top 3 results
        });

        const response = await fetch(`/api/wiki?${params.toString()}`);
        if (!response.ok) return [];

        const data = await response.json();
        if (!data.query?.search) return [];

        return data.query.search.map((item: any) => ({
            title: item.title,
            link: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
            snippet: item.snippet.replace(/<\/?[^>]+(>|$)/g, ""), // Strip HTML tags
            source: 'Wikipedia'
        }));
    } catch (e) {
        console.error("Wikipedia Search Error:", e);
        return [];
    }
}

/**
 * Perform a DuckDuckGo HTML scraping search via Backend Middleware.
 * Extremely robust, completely bypasses CORS and browser User-Agent blocks.
 */
export async function searchDuckDuckGoWeb(query: string): Promise<SearchResult[]> {
    try {
        const response = await fetch(`/api/real-search?q=${encodeURIComponent(query)}`);

        if (!response.ok) return [];

        const data = await response.json();
        return data.results || [];
    } catch (e) {
        console.error("DDG Web Search Error:", e);
        return [];
    }
}

/**
 * Perform a Weather Check via Open-Meteo (Geocoding + Weather based on query)
 * Checks if query contains "weather" and extracts city name.
 */
export async function searchWeather(query: string): Promise<SearchResult[]> {
    const normQuery = query.toLowerCase();

    // Basic trigger check
    if (!normQuery.includes('weather') && !normQuery.includes('temperature') && !normQuery.includes('forecast')) {
        return [];
    }

    // Extract potential city name 
    let city = query
        .replace(/weather|temperature|forecast|in|at|current|today/gi, '')
        .trim();

    if (!city) return [];
    city = city.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ""); // Remove punctuation

    try {
        // 1. Geocoding
        const geoResponse = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
        if (!geoResponse.ok) return [];

        const geoData = await geoResponse.json();
        if (!geoData.results || geoData.results.length === 0) return [];

        const { latitude, longitude, name, country } = geoData.results[0];

        // 2. Weather
        const weatherResponse = await fetch(`/api/weather/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`);
        if (!weatherResponse.ok) return [];

        const weatherData = await weatherResponse.json();
        if (!weatherData.current_weather) return [];

        const { temperature, windspeed, weathercode } = weatherData.current_weather;

        return [{
            title: `Current Weather in ${name}, ${country}`,
            link: `https://open-meteo.com/en/docs`,
            snippet: `Temperature: ${temperature}°C, Wind Speed: ${windspeed} km/h. WMO Weather Code: ${weathercode}.`,
            source: 'Open-Meteo'
        }];
    } catch (e) {
        console.error("Weather Search Error:", e);
        return [];
    }
}

/**
 * Main Search Aggregator
 */
export async function performSearch(query: string): Promise<string> {
    // Strip leading/trailing quotes that the AI might accidentally include
    const cleanQuery = query.replace(/^["']|["']$/g, '').trim();

    console.log(`[Search Tool] Executing REAL STRONG search for: ${cleanQuery}`);

    // Fire requests concurrently
    const promises = [
        searchWikipedia(cleanQuery),
        searchDuckDuckGoWeb(cleanQuery), // Uses the new scraper
        searchWeather(cleanQuery)
    ];

    const resultsNested = await Promise.all(promises);
    const allResults = resultsNested.flat();

    if (allResults.length === 0) {
        return `[SEARCH RESULTS FOR "${cleanQuery}"]\nNo specific results found. The query might be too obscure or network access failed.`;
    }

    // Filter out duplicates based on links if any
    const uniqueResults: SearchResult[] = [];
    const seenLinks = new Set<string>();

    for (const res of allResults) {
        if (!seenLinks.has(res.link)) {
            seenLinks.add(res.link);
            uniqueResults.push(res);
        }
    }

    // Format top results (Limit to 5 strongest)
    const formatted = uniqueResults.slice(0, 5).map((r, i) =>
        `- Result ${i + 1}: ${r.title} (${r.source})\n` +
        `  Link: ${r.link}\n` +
        `  Snippet: ${r.snippet}`
    ).join('\n\n');

    return `[SEARCH RESULTS FOR "${query}"]\n${formatted}\n\n[SYSTEM DIRECTIVE]: Use the above information to provide a comprehensive, accurate answer. Incorporate facts and cite sources implicitly by mentioning where the data comes from if relevant.`;
}
