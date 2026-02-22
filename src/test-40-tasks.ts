import { getOrchestrator } from "./agent/orchestrator.js";
import { setLogLevel } from "./logger.js";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv(): void {
    const envPath = resolve(process.cwd(), ".env");
    if (!existsSync(envPath)) return;
    try {
        const content = readFileSync(envPath, "utf-8");
        for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const eqIndex = trimmed.indexOf("=");
            if (eqIndex === -1) continue;
            const key = trimmed.slice(0, eqIndex).trim();
            const value = trimmed.slice(eqIndex + 1).trim();
            if (key && !(key in process.env)) {
                process.env[key] = value;
            }
        }
    } catch {
        // Ignore
    }
}

const complexTasks = [
    "Open the calculator app, calculate 25 * 4, and then open the clock app to set a timer for that many minutes.",
    "Check my email for flight confirmations, extract the flight number, and add an event to my calendar for tomorrow at 8 AM.",
    "Open Google Maps, find directions to the nearest coffee shop, take a screenshot of the route, and send it to Alice via WhatsApp.",
    "Check the current weather in New York. If it's raining, set a reminder to bring an umbrella. If it's sunny, set a reminder to pack sunglasses.",
    "Open the Settings app, navigate to Display, decrease the brightness to 50%, and then turn on Dark Mode.",
    "Read the last 3 messages in my family WhatsApp group, summarize them, and send the summary to my personal notes app.",
    "Open YouTube, search for 'latest tech news', play the first video for 30 seconds, and then pause it.",
    "Go to the contacts app, create a new contact named 'Plumber' with the number '555-1234', and then send them an SMS saying 'Need a quote'.",
    "Open the Chrome browser, search for 'best chocolate chip cookie recipe', scroll down to the ingredients, and take a screenshot.",
    "Open the Photos app, find the most recent photo, share it to Instagram Stories, and add a sticker.",
    "Check my to-do list app, find any tasks marked 'urgent', and create a calendar event for each one for this afternoon.",
    "Open the clock app, check if any alarms are set for tomorrow morning. If not, set one for 7:00 AM.",
    "Navigate to the battery settings, check the current percentage. If it's below 20%, turn on battery saver mode.",
    "Open the Twitter application, search for '#AI', read the top 3 tweets, and compose a draft tweet summarizing them.",
    "Go to the Google Play Store, search for 'language learning apps', install the first recommended app, and open it.",
    "Open the Calendar app, find my next meeting, message the participants on Slack to say I'll be 5 minutes late.",
    "Open the Voice Recorder app, start a new recording, wait 10 seconds, stop the recording, and rename it to 'Voice Note 1'.",
    "Check my missed calls, find the most recent one, and send them an SMS saying 'I will call you back later.'",
    "Open the File Manager, navigate to the Downloads folder, find all PDF files, and move them to a new folder named 'Documents'.",
    "Open the Spotify app, search for 'Focus Playlist', start playing it, and set a sleep timer for 60 minutes.",
    "Open the News app, read the top headline from the Technology section, and send a link to it via email to colleague@example.com",
    "Go to Settings > Network & Internet, check if Wi-Fi is connected. If not, turn it on and connect to the strongest network.",
    "Open the Camera app, switch to video mode, record a 5-second video, and then delete it from the gallery.",
    "Open the LinkedIn app, accept the most recent connection request, and send them a welcome message.",
    "Check the Google Keep app for a note titled 'Groceries'. If it exists, add 'Milk' to the bottom of the list.",
    "Open the Uber app, set the destination to 'Airport', check the estimated price, but do not book the ride.",
    "Go back to the home screen, swipe right two times, and open the first app you see in the top left corner.",
    "Open the Gmail app, select all promotional emails received today, and move them to the trash.",
    "Open the Google Translate app, set the language pair to English to Spanish, type 'Where is the library?', and play the audio pronunciation.",
    "Open the calculator app, type 100, divide by 0, and tell me what the error message says.",
    "Open the Messages app, look for a verification code received in the last 10 minutes, and copy it to the clipboard.",
    "Open the Chrome browser, go to github.com, search for 'open-agent', and read the project description.",
    "Navigate to Settings > Apps, find 'YouTube', force stop it, and clear its cache.",
    "Open the Discord app, go to the #general channel of my first server, and type '!help'.",
    "Open the Google Maps app, drop a pin at my current location, and save it to the 'Favorites' list.",
    "Check the notification shade, dismiss all non-persistent notifications, and take a screenshot of what's left.",
    "Open the YouTube Music app, find my 'Liked Songs' playlist, and shuffle play it.",
    "Open the Contacts app, search for 'Dad', initiate a phone call, and hang up immediately.",
    "Open the Settings app, go to 'About phone', read the Android version, and save that information to a note.",
    "Open the Chrome browser, open 5 new empty tabs, and then close them all one by one."
];

async function runTests() {
    loadEnv();
    setLogLevel("info");

    console.log("Starting 40 complex task simulation over Yakshas-v1...");

    const orch = getOrchestrator();
    await orch.initialize();

    const results = [];

    for (let i = 0; i < complexTasks.length; i++) {
        const task = complexTasks[i];
        console.log(`\n\n[TASK ${i + 1}/40] Executing: "${task}"`);

        const startTime = Date.now();
        try {
            const result = await orch.executeTask(task, {
                onMessage: (msg) => console.log(`[AGENT]: ${msg}`)
            });
            const duration = Date.now() - startTime;

            console.log(`[RESULT ${i + 1}] Success: ${result.success}`);
            console.log(`[RESULT ${i + 1}] Tool Calls: ${result.totalToolCalls}`);
            console.log(`[RESULT ${i + 1}] Duration: ${duration}ms`);

            results.push({
                taskIndex: i + 1,
                task,
                success: result.success,
                message: result.message,
                totalToolCalls: result.totalToolCalls,
                durationMs: duration
            });
        } catch (e) {
            console.error(`[ERROR ${i + 1}] Failed to execute task:`, e);
            results.push({
                taskIndex: i + 1,
                task,
                success: false,
                message: e instanceof Error ? e.message : String(e),
                totalToolCalls: 0,
                durationMs: Date.now() - startTime
            });
        }
    }

    writeFileSync("test_results.json", JSON.stringify(results, null, 2));
    console.log("\nFinished executing 40 tasks. Results saved to test_results.json");
    process.exit(0);
}

runTests().catch(console.error);
