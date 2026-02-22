/**
 * Pre-built Skill Templates — 150 curated skills across 6 categories.
 *
 * Categories:
 *   1. Social Media (20 skills)
 *   2. Business (50 skills)
 *   3. Engineering (50 skills)
 *   4. Personal Assistant (6 skills)
 *   5. Medical Consultant (3 skills)
 *   6. Moral Values (21 skills)
 *
 * These skill templates give the agent a head start by providing
 * proven instructions and workflows before any RL-based learning.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type SkillTemplate = {
    id: string;
    category: SkillCategory;
    name: string;
    description: string;
    instructions: string[];
    sampleWorkflow?: {
        task: string;
        steps: string[];
    };
};

export type SkillCategory =
    | "social_media"
    | "business"
    | "engineering"
    | "personal_assistant"
    | "medical_consultant"
    | "moral_values";

// ─── Social Media Skills (20) ────────────────────────────────────────────────

const socialMediaSkills: SkillTemplate[] = [
    {
        id: "sm_01",
        category: "social_media",
        name: "WhatsApp Message Management",
        description: "Read, reply, and manage WhatsApp conversations",
        instructions: [
            "Open WhatsApp and navigate to the correct chat",
            "Read recent messages using UI tree before replying",
            "Match the tone and language of the conversation",
            "Use short, natural messages — avoid sounding robotic",
            "Send media via the attachment button (📎)",
        ],
        sampleWorkflow: {
            task: "Reply to latest WhatsApp message",
            steps: ["Open WhatsApp", "Read UI tree for latest chat", "Tap chat", "Read messages", "Type natural reply", "Send"],
        },
    },
    {
        id: "sm_02",
        category: "social_media",
        name: "Instagram Post Interaction",
        description: "Like, comment, and browse Instagram posts",
        instructions: [
            "Scroll feed using swipe gestures to discover content",
            "Double-tap to like posts quickly",
            "Leave genuine, contextual comments — avoid generic ones",
            "Use the search tab to find specific accounts or hashtags",
            "Check Stories by tapping profile pictures at the top",
        ],
    },
    {
        id: "sm_03",
        category: "social_media",
        name: "Instagram Story Management",
        description: "View, create, and interact with Instagram Stories",
        instructions: [
            "Stories appear at the top of the feed as circular icons",
            "Tap to view, swipe left to skip to next story",
            "Swipe up on a story to reply — keep replies casual",
            "To post a story: tap your profile icon → camera → capture",
            "Add stickers, text, or polls for engagement",
        ],
    },
    {
        id: "sm_04",
        category: "social_media",
        name: "Twitter/X Post & Engage",
        description: "Post tweets, reply, retweet, and browse timeline",
        instructions: [
            "Keep tweets concise — under 280 characters",
            "Use relevant hashtags sparingly (2-3 max)",
            "Retweet with quote for added context",
            "Check trending topics via the Explore tab",
            "Reply threads should maintain context from the original post",
        ],
    },
    {
        id: "sm_05",
        category: "social_media",
        name: "Facebook Post Management",
        description: "Create posts, react, comment, and manage Facebook",
        instructions: [
            "Use the 'What's on your mind?' box to compose posts",
            "Add photos via the photo icon below the post box",
            "React to posts by long-pressing the Like button",
            "Tag friends using @ mentions in posts and comments",
            "Check notifications bell for recent interactions",
        ],
    },
    {
        id: "sm_06",
        category: "social_media",
        name: "Telegram Channel Management",
        description: "Send messages, manage groups, and use bots in Telegram",
        instructions: [
            "Use the search bar to find chats, channels, and bots",
            "Pin important messages by long-pressing → Pin",
            "Forward messages using the share/forward button",
            "Bots respond to /commands — check /help for each bot",
            "Mute channels via the three-dot menu → Mute",
        ],
    },
    {
        id: "sm_07",
        category: "social_media",
        name: "YouTube Video Interaction",
        description: "Search, watch, like, comment, and subscribe on YouTube",
        instructions: [
            "Use the search icon (🔎) to find videos",
            "Like videos with the thumbs-up button below the player",
            "Subscribe to channels via the Subscribe button",
            "Add videos to playlists via Save → select playlist",
            "Control playback with tap gestures on the player",
        ],
    },
    {
        id: "sm_08",
        category: "social_media",
        name: "Snapchat Messaging",
        description: "Send snaps, chat, and manage Snapchat",
        instructions: [
            "Swipe right from camera to access chats",
            "Tap and hold to view received snaps",
            "Use the camera to take snaps — add filters by swiping left/right",
            "Send text chats by tapping the chat icon",
            "Check Snap Map by pinching on the camera screen",
        ],
    },
    {
        id: "sm_09",
        category: "social_media",
        name: "LinkedIn Professional Networking",
        description: "Connect, post, and engage on LinkedIn",
        instructions: [
            "Keep posts professional and industry-relevant",
            "Connect with a personalized note — never use default message",
            "Engage with posts by liking and leaving thoughtful comments",
            "Share articles with brief commentary for better engagement",
            "Update profile sections to reflect current skills and roles",
        ],
    },
    {
        id: "sm_10",
        category: "social_media",
        name: "TikTok Content Interaction",
        description: "Browse, like, comment, and share TikTok videos",
        instructions: [
            "Swipe up to scroll through the For You feed",
            "Double-tap to like videos",
            "Tap the comment icon on the right to leave comments",
            "Share videos via the arrow icon → copy link or send",
            "Follow creators by tapping their profile on the video",
        ],
    },
    {
        id: "sm_11",
        category: "social_media",
        name: "Pinterest Board Management",
        description: "Search, pin, and organize Pinterest boards",
        instructions: [
            "Search for ideas using keywords in the search bar",
            "Save pins to boards using the Save button",
            "Create new boards from the profile → + button",
            "Organize pins by dragging within boards",
            "Share pins via the share icon",
        ],
    },
    {
        id: "sm_12",
        category: "social_media",
        name: "Reddit Browsing & Posting",
        description: "Browse subreddits, upvote, comment, and post on Reddit",
        instructions: [
            "Navigate to subreddits using the search or r/ format",
            "Upvote/downvote posts with the arrow buttons",
            "Read comments before adding your own to avoid duplicates",
            "Follow subreddit rules before posting — check sidebar",
            "Use markdown formatting in comments for better readability",
        ],
    },
    {
        id: "sm_13",
        category: "social_media",
        name: "Discord Server Interaction",
        description: "Chat, join voice, and manage Discord servers",
        instructions: [
            "Swipe right to see server list and channels",
            "Use the text input at the bottom to send messages",
            "Join voice channels by tapping them",
            "Mention users with @username for direct notices",
            "Check pinned messages for important channel info",
        ],
    },
    {
        id: "sm_14",
        category: "social_media",
        name: "Content Scheduling",
        description: "Plan and schedule social media posts across platforms",
        instructions: [
            "Compose the post content before scheduling",
            "Use cron_add to schedule at optimal posting times",
            "Best times: 9-11 AM and 7-9 PM in user's timezone",
            "Prepare image/video content before the scheduled time",
            "Verify posts went live by checking the platform after the scheduled time",
        ],
    },
    {
        id: "sm_15",
        category: "social_media",
        name: "Social Media Monitoring",
        description: "Track mentions, replies, and engagement across platforms",
        instructions: [
            "Check notification tabs on each platform periodically",
            "Use event_watch to trigger on new notification events",
            "Prioritize direct messages over public mentions",
            "Track engagement metrics (likes, comments, shares)",
            "Report unusual activity or spam to the user",
        ],
    },
    {
        id: "sm_16",
        category: "social_media",
        name: "Group Chat Management",
        description: "Manage group conversations across messaging platforms",
        instructions: [
            "Read the full context before responding in groups",
            "Avoid replying to every message — respond to direct mentions",
            "Use the reply-to-specific-message feature when available",
            "Mute low-priority groups to reduce noise",
            "Share relevant media and links when appropriate",
        ],
    },
    {
        id: "sm_17",
        category: "social_media",
        name: "Profile Optimization",
        description: "Update and optimize social media profiles",
        instructions: [
            "Update profile picture from the profile settings",
            "Write concise, keyword-rich bios",
            "Add links to other social profiles or websites",
            "Set privacy settings appropriate to the platform",
            "Keep usernames consistent across platforms when possible",
        ],
    },
    {
        id: "sm_18",
        category: "social_media",
        name: "Content Curation & Sharing",
        description: "Find, save, and share interesting content",
        instructions: [
            "Bookmark interesting content for later sharing",
            "Credit original creators when sharing content",
            "Add personal commentary when sharing to add value",
            "Use the platform's native share features for best formatting",
            "Save content to organized collections or lists",
        ],
    },
    {
        id: "sm_19",
        category: "social_media",
        name: "Hashtag & Trend Tracking",
        description: "Monitor trending topics and relevant hashtags",
        instructions: [
            "Check the Explore/Trending section of each platform",
            "Use hashtags relevant to the user's interests",
            "Don't overuse hashtags — quality over quantity",
            "Track industry-specific hashtags for professional accounts",
            "Note trending topics that align with the user's brand or interests",
        ],
    },
    {
        id: "sm_20",
        category: "social_media",
        name: "Direct Message Handling",
        description: "Read, reply, and manage direct messages across platforms",
        instructions: [
            "Prioritize unread DMs from known contacts",
            "Reply promptly — aim for natural, conversational tone",
            "Handle spam/unknown senders by ignoring or reporting",
            "Use voice messages or images when text alone isn't enough",
            "Keep sensitive conversations private — never share in public",
        ],
    },
];

// ─── Business Skills (50) ────────────────────────────────────────────────────

const businessSkills: SkillTemplate[] = [
    { id: "biz_01", category: "business", name: "Email Draft & Send", description: "Compose and send professional emails via Gmail", instructions: ["Use formal greeting and sign-off", "Keep subject line clear and actionable", "Proofread before sending", "CC relevant stakeholders", "Attach files using the paperclip icon"] },
    { id: "biz_02", category: "business", name: "Calendar Event Creation", description: "Schedule meetings and events in Google Calendar", instructions: ["Include title, time, location, and attendees", "Set reminders 15-30 minutes before", "Add video meeting link when applicable", "Check for conflicts before scheduling", "Include agenda in event description"] },
    { id: "biz_03", category: "business", name: "Contact Management", description: "Add, edit, and organize phone contacts", instructions: ["Save contacts with full name and company", "Add email, phone, and role", "Group contacts by organization or project", "Update outdated contact information", "Back up contacts periodically"] },
    { id: "biz_04", category: "business", name: "Invoice Tracking", description: "Track and manage invoices and payments", instructions: ["Check email for incoming invoices", "Log invoice amounts and due dates", "Set reminders for upcoming payment deadlines", "Verify payment confirmations", "Organize invoices by client or month"] },
    { id: "biz_05", category: "business", name: "Meeting Notes Capture", description: "Record and organize meeting notes", instructions: ["Note date, attendees, and agenda at the top", "Capture key decisions and action items", "Assign owners and deadlines to action items", "Share notes with attendees after the meeting", "Store notes in an organized folder"] },
    { id: "biz_06", category: "business", name: "Task Delegation", description: "Assign and track tasks via messaging apps", instructions: ["Be specific about what needs to be done", "Include deadline and priority level", "Confirm the assignee acknowledges", "Follow up on overdue tasks", "Track task status and completion"] },
    { id: "biz_07", category: "business", name: "Client Communication", description: "Manage professional client correspondence", instructions: ["Respond within 24 hours to client messages", "Maintain professional tone throughout", "Document all client requests and responses", "Escalate urgent issues immediately", "Confirm deliverables and timelines in writing"] },
    { id: "biz_08", category: "business", name: "Expense Tracking", description: "Log and categorize business expenses", instructions: ["Photograph receipts using the camera", "Log date, amount, category, and vendor", "Separate personal from business expenses", "Track recurring subscriptions", "Generate monthly expense summaries"] },
    { id: "biz_09", category: "business", name: "CRM Data Entry", description: "Update customer records in CRM apps", instructions: ["Log all customer interactions promptly", "Update contact info and deal stages", "Add notes for context on follow-ups", "Set next action dates", "Tag leads by source and priority"] },
    { id: "biz_10", category: "business", name: "Sales Pipeline Management", description: "Track leads through the sales funnel", instructions: ["Move leads through stages as conversations progress", "Log call outcomes and next steps", "Prioritize high-value opportunities", "Set follow-up reminders", "Report weekly pipeline status"] },
    { id: "biz_11", category: "business", name: "Competitive Research", description: "Monitor competitors via apps and web", instructions: ["Follow competitor social media accounts", "Track competitor app updates and reviews", "Note pricing changes and new features", "Save competitor content for analysis", "Summarize findings periodically"] },
    { id: "biz_12", category: "business", name: "Report Generation", description: "Compile data and create business reports", instructions: ["Gather data from multiple sources", "Organize by key metrics and KPIs", "Include visual charts when possible", "Write executive summary at the top", "Send to stakeholders on schedule"] },
    { id: "biz_13", category: "business", name: "Team Standup Updates", description: "Collect and share daily standup updates", instructions: ["Ask each team member for: done, doing, blocked", "Compile updates in a consistent format", "Share in the team channel by standup time", "Flag blockers for immediate attention", "Keep updates brief and actionable"] },
    { id: "biz_14", category: "business", name: "Document Review", description: "Review and annotate shared documents", instructions: ["Read the document thoroughly before commenting", "Use specific line references for feedback", "Distinguish between required changes and suggestions", "Acknowledge positive aspects", "Set a deadline for revision turnaround"] },
    { id: "biz_15", category: "business", name: "Vendor Communication", description: "Manage vendor relationships and orders", instructions: ["Maintain a list of preferred vendors", "Request quotes in writing with specifications", "Confirm delivery dates and terms", "Track order status and shipments", "Evaluate vendor performance regularly"] },
    { id: "biz_16", category: "business", name: "Budget Planning", description: "Create and monitor department budgets", instructions: ["List all expected income and expenses", "Categorize spending by department or project", "Compare actual vs planned monthly", "Flag overruns immediately", "Adjust forecasts quarterly"] },
    { id: "biz_17", category: "business", name: "HR Onboarding Support", description: "Assist with employee onboarding tasks", instructions: ["Send welcome message to new hires", "Share onboarding checklist and documents", "Schedule intro meetings with team members", "Verify access to required tools and apps", "Check in after first week"] },
    { id: "biz_18", category: "business", name: "Customer Feedback Collection", description: "Gather and organize customer feedback", instructions: ["Send feedback surveys via messaging apps", "Log feedback with date and customer info", "Categorize by theme (product, service, support)", "Identify recurring issues", "Share insights with product team"] },
    { id: "biz_19", category: "business", name: "Project Status Tracking", description: "Monitor and report on project milestones", instructions: ["Track tasks against timeline and milestones", "Update status in project management apps", "Identify at-risk items early", "Send weekly status reports to stakeholders", "Document changes to scope or timeline"] },
    { id: "biz_20", category: "business", name: "Contract Management", description: "Track contracts, renewals, and deadlines", instructions: ["Log contract start and end dates", "Set reminders 30 days before renewal", "Store signed contracts in organized folders", "Track key terms and obligations", "Flag contracts needing renegotiation"] },
    { id: "biz_21", category: "business", name: "Market Research", description: "Gather market data and industry insights", instructions: ["Search for industry reports and articles", "Track market trends and statistics", "Monitor news for industry developments", "Save relevant data for analysis", "Summarize key findings for decision-makers"] },
    { id: "biz_22", category: "business", name: "Presentation Preparation", description: "Prepare slides and talking points for presentations", instructions: ["Outline key points before creating slides", "Use data and visuals to support arguments", "Keep slides clean — no wall of text", "Prepare speaker notes with key talking points", "Practice timing if time-limited"] },
    { id: "biz_23", category: "business", name: "Inventory Management", description: "Track stock levels and reorder inventory", instructions: ["Log current stock quantities", "Set minimum stock level alerts", "Reorder before reaching minimum levels", "Track supplier lead times", "Do monthly inventory audits"] },
    { id: "biz_24", category: "business", name: "Shipping & Logistics", description: "Track shipments and delivery status", instructions: ["Log tracking numbers for all shipments", "Monitor delivery status via carrier apps", "Notify recipients of expected delivery dates", "Handle delays by contacting the carrier", "Confirm receipt of deliveries"] },
    { id: "biz_25", category: "business", name: "Social Media Marketing", description: "Plan and execute social media campaigns", instructions: ["Define campaign goals and target audience", "Create content calendar with posting schedule", "Use platform-specific best practices", "Monitor engagement metrics daily", "Adjust strategy based on performance data"] },
    { id: "biz_26", category: "business", name: "Lead Generation", description: "Identify and qualify potential business leads", instructions: ["Research potential clients in target industries", "Collect contact information from public sources", "Craft personalized outreach messages", "Track response rates and follow up", "Qualify leads based on fit and interest"] },
    { id: "biz_27", category: "business", name: "Payment Processing", description: "Send and receive payments via mobile banking", instructions: ["Verify recipient details before sending", "Double-check amounts and currency", "Save transaction confirmations", "Track pending payments", "Reconcile payments with invoices"] },
    { id: "biz_28", category: "business", name: "Customer Support Triage", description: "Categorize and route customer support requests", instructions: ["Read the full request before categorizing", "Assign priority based on urgency and impact", "Route to the appropriate team or person", "Acknowledge receipt to the customer", "Track resolution time"] },
    { id: "biz_29", category: "business", name: "Brand Monitoring", description: "Track brand mentions and reputation online", instructions: ["Search for brand name across social platforms", "Monitor review sites for new reviews", "Track sentiment of mentions (positive/negative)", "Respond to negative reviews professionally", "Report brand health weekly"] },
    { id: "biz_30", category: "business", name: "Partnership Outreach", description: "Identify and reach out to potential partners", instructions: ["Research potential partner organizations", "Identify mutual benefits in partnership", "Craft personalized outreach messages", "Follow up if no response in 1 week", "Document partnership discussions and terms"] },
    { id: "biz_31", category: "business", name: "Data Backup & Sync", description: "Ensure business data is backed up and synced", instructions: ["Verify cloud sync is enabled for key apps", "Back up important documents to cloud storage", "Check backup status periodically", "Test restoration of backed-up data", "Keep multiple backup copies of critical data"] },
    { id: "biz_32", category: "business", name: "Compliance Monitoring", description: "Track regulatory compliance requirements", instructions: ["Maintain a checklist of compliance requirements", "Set reminders for filing deadlines", "Document all compliance activities", "Report compliance status to management", "Stay updated on regulatory changes"] },
    { id: "biz_33", category: "business", name: "Training Coordination", description: "Organize team training sessions and materials", instructions: ["Schedule training sessions in advance", "Share pre-reading materials beforehand", "Track attendance and completion", "Collect feedback after training", "Maintain a training log for each team member"] },
    { id: "biz_34", category: "business", name: "Financial Reporting", description: "Compile and share financial summaries", instructions: ["Gather data from banking and accounting apps", "Calculate key metrics (revenue, expenses, profit)", "Compare against previous periods", "Highlight significant variances", "Share with finance team on schedule"] },
    { id: "biz_35", category: "business", name: "Office Supply Management", description: "Track and reorder office supplies", instructions: ["Maintain a list of regularly needed supplies", "Monitor stock levels monthly", "Order from preferred suppliers", "Track spending against supply budget", "Consolidate orders to minimize shipping costs"] },
    { id: "biz_36", category: "business", name: "Recruitment Support", description: "Assist with hiring by managing job postings and applications", instructions: ["Post job listings on relevant platforms", "Screen incoming applications for basic qualifications", "Schedule interviews via calendar", "Send rejection or next-steps emails", "Track candidate pipeline status"] },
    { id: "biz_37", category: "business", name: "Customer Retention", description: "Engage existing customers to prevent churn", instructions: ["Send check-in messages to inactive customers", "Share relevant updates and offer promotions", "Ask for feedback on recent experiences", "Resolve complaints quickly and empathetically", "Track retention metrics monthly"] },
    { id: "biz_38", category: "business", name: "Price Comparison", description: "Compare prices across vendors and platforms", instructions: ["List items to compare with specifications", "Check multiple vendors or shopping apps", "Note prices, shipping costs, and delivery times", "Factor in reviews and vendor reputation", "Present comparison summary to decision-maker"] },
    { id: "biz_39", category: "business", name: "Event Planning", description: "Organize business events, lunches, and team activities", instructions: ["Define event purpose, date, and attendee list", "Book venue or arrange logistics", "Send invitations with all details", "Confirm RSVPs and dietary requirements", "Prepare agenda and materials"] },
    { id: "biz_40", category: "business", name: "Workflow Automation", description: "Set up automated workflows using cron and events", instructions: ["Identify repetitive tasks suitable for automation", "Use cron_add for time-based automation", "Use event_watch for event-driven automation", "Test automated workflows before activating", "Monitor automated tasks for errors"] },
    { id: "biz_41", category: "business", name: "Performance Review Prep", description: "Prepare materials for employee performance reviews", instructions: ["Collect performance data and metrics", "Note achievements and areas for improvement", "Gather peer feedback if applicable", "Prepare talking points for the review meeting", "Schedule review meetings in advance"] },
    { id: "biz_42", category: "business", name: "Newsletter Composition", description: "Draft and distribute business newsletters", instructions: ["Plan content topics in advance", "Write concise, engaging copy", "Include relevant links and images", "Proofread for errors", "Schedule distribution at optimal times"] },
    { id: "biz_43", category: "business", name: "Risk Assessment", description: "Identify and document business risks", instructions: ["List potential risks by category", "Assess probability and impact of each", "Define mitigation strategies", "Assign risk owners", "Review and update risk register quarterly"] },
    { id: "biz_44", category: "business", name: "Stakeholder Updates", description: "Keep stakeholders informed on project progress", instructions: ["Identify key stakeholders and their information needs", "Send regular updates on agreed schedule", "Highlight achievements and risks", "Be transparent about challenges", "Tailor communication style to each stakeholder"] },
    { id: "biz_45", category: "business", name: "Quality Assurance", description: "Check deliverables against quality standards", instructions: ["Review deliverables against requirements", "Document defects or issues found", "Prioritize fixes by severity", "Verify fixes are implemented correctly", "Maintain a QA log for tracking"] },
    { id: "biz_46", category: "business", name: "Travel Booking", description: "Book flights, hotels, and transportation", instructions: ["Compare options across booking apps", "Book refundable options when possible", "Confirm booking details and save confirmations", "Set reminders for check-in and travel dates", "Share itinerary with relevant colleagues"] },
    { id: "biz_47", category: "business", name: "Time Tracking", description: "Log time spent on tasks and projects", instructions: ["Start timer when beginning a task", "Log time accurately with task description", "Categorize by project or client", "Review weekly for accuracy", "Submit timesheets on schedule"] },
    { id: "biz_48", category: "business", name: "Payroll Coordination", description: "Assist with payroll processing and queries", instructions: ["Collect timesheets and attendance data", "Verify calculations before processing", "Handle payroll queries confidentially", "Process on time every pay period", "Maintain payroll records securely"] },
    { id: "biz_49", category: "business", name: "Legal Document Management", description: "Organize and track legal documents", instructions: ["Store legal documents in secure, organized folders", "Track key dates (filing deadlines, renewals)", "Set reminders for upcoming legal deadlines", "Ensure proper signatures and approvals", "Consult legal counsel for complex matters"] },
    { id: "biz_50", category: "business", name: "Business Continuity Planning", description: "Maintain plans for business disruption scenarios", instructions: ["Document critical business processes", "Identify backup resources and contacts", "Plan communication strategy for emergencies", "Test continuity plans annually", "Update plans when processes change"] },
];

// ─── Engineering Skills (50) ─────────────────────────────────────────────────

const engineeringSkills: SkillTemplate[] = [
    { id: "eng_01", category: "engineering", name: "System Monitoring", description: "Monitor device system resources and performance", instructions: ["Use 'top' or 'ps' to check CPU and memory usage", "Monitor disk space with 'df -h'", "Check running processes with 'ps -A'", "Use 'dumpsys meminfo' for detailed memory", "Set up periodic checks with cron for proactive monitoring"] },
    { id: "eng_02", category: "engineering", name: "Network Diagnostics", description: "Troubleshoot network connectivity issues", instructions: ["Check WiFi status via 'ip addr show wlan0'", "Test connectivity with 'ping' command", "Use 'netstat' to view network connections", "Check DNS resolution with 'nslookup'", "Monitor network traffic with 'dumpsys connectivity'"] },
    { id: "eng_03", category: "engineering", name: "Log Analysis", description: "Analyze system and app logs for debugging", instructions: ["Use 'logcat' to view live Android logs", "Filter logs by tag: 'logcat -s TAG_NAME'", "Filter by priority: 'logcat *:E' for errors only", "Search logs with 'logcat | grep keyword'", "Clear old logs with 'logcat -c'"] },
    { id: "eng_04", category: "engineering", name: "App Crash Debugging", description: "Diagnose and recover from app crashes", instructions: ["Check logcat for crash stack traces", "Use 'dumpsys activity activities' for app state", "Force-stop and relaunch crashed apps", "Clear app cache if crash persists", "Document crash patterns for reporting"] },
    { id: "eng_05", category: "engineering", name: "Battery Optimization", description: "Monitor and optimize device battery usage", instructions: ["Check battery stats with 'dumpsys battery'", "Identify power-hungry apps with 'dumpsys batterystats'", "Reduce screen brightness to save power", "Disable unnecessary background services", "Enable battery saver mode when low"] },
    { id: "eng_06", category: "engineering", name: "Storage Management", description: "Monitor and free up device storage", instructions: ["Check storage with 'df -h /data'", "Find large files with 'find /sdcard -size +100M'", "Clear app caches via settings or 'pm clear'", "Remove unnecessary downloads and temp files", "Move data to external storage when available"] },
    { id: "eng_07", category: "engineering", name: "App Installation & Updates", description: "Install, update, and manage apps via ADB", instructions: ["Install APK: 'pm install /path/to/app.apk'", "List installed apps: 'pm list packages -3'", "Uninstall: 'pm uninstall package.name'", "Check app version: 'dumpsys package pkg | grep version'", "Clear app data: 'pm clear package.name'"] },
    { id: "eng_08", category: "engineering", name: "Permission Management", description: "Check and manage app permissions", instructions: ["List app permissions: 'dumpsys package pkg | grep permission'", "Grant permission: 'pm grant pkg android.permission.X'", "Revoke permission: 'pm revoke pkg android.permission.X'", "Check runtime permissions in app settings", "Only grant permissions necessary for the task"] },
    { id: "eng_09", category: "engineering", name: "Process Management", description: "Monitor, start, and stop system processes", instructions: ["List processes: 'ps -A' or 'ps -ef'", "Find specific process: 'ps -A | grep name'", "Kill process: 'kill PID' or 'am force-stop pkg'", "Check process CPU usage: 'top -n 1'", "Monitor process tree: 'ps -AT'"] },
    { id: "eng_10", category: "engineering", name: "File System Navigation", description: "Navigate and manage files on the device", instructions: ["List files: 'ls -la /path'", "Navigate: 'cd /path' then 'ls'", "Copy files: 'cp source dest'", "Move files: 'mv source dest'", "Create directories: 'mkdir -p /path/to/dir'"] },
    { id: "eng_11", category: "engineering", name: "Screen Recording", description: "Record the device screen for debugging or demos", instructions: ["Record: 'screenrecord /sdcard/recording.mp4'", "Limit duration: 'screenrecord --time-limit 30 /path'", "Pull recording: use adb pull command", "Convert format if needed for sharing", "Clean up recordings after use"] },
    { id: "eng_12", category: "engineering", name: "Database Inspection", description: "View and query SQLite databases on the device", instructions: ["Find databases: 'find /data/data/pkg -name *.db'", "Query: 'sqlite3 /path/db.db \"SELECT * FROM table\"'", "List tables: 'sqlite3 db.db \".tables\"'", "Check schema: 'sqlite3 db.db \".schema table\"'", "Always work on copies, never modify production databases"] },
    { id: "eng_13", category: "engineering", name: "API Endpoint Testing", description: "Test REST APIs from the device", instructions: ["Use 'curl' for HTTP requests from shell", "Test GET: 'curl -s https://api.example.com/endpoint'", "Test POST: 'curl -X POST -d \"data\" url'", "Check response headers: 'curl -I url'", "Parse JSON responses: pipe to 'python -m json.tool'"] },
    { id: "eng_14", category: "engineering", name: "WiFi Configuration", description: "Connect and manage WiFi networks", instructions: ["Scan networks: 'cmd wifi list-networks'", "Check current WiFi: 'dumpsys wifi | grep SSID'", "Toggle WiFi via settings UI or 'svc wifi enable/disable'", "Forget networks via WiFi settings", "Check signal strength: 'dumpsys wifi | grep rssi'"] },
    { id: "eng_15", category: "engineering", name: "Bluetooth Management", description: "Manage Bluetooth connections and devices", instructions: ["Toggle Bluetooth: 'svc bluetooth enable/disable'", "List paired devices via Settings → Bluetooth", "Pair new devices from the Bluetooth settings screen", "Check Bluetooth status: 'dumpsys bluetooth_manager'", "Disconnect devices by toggling Bluetooth off/on"] },
    { id: "eng_16", category: "engineering", name: "Security Audit", description: "Check device security configuration", instructions: ["Verify screen lock is enabled via settings", "Check for unknown app installation permission", "Review app permissions for sensitive access", "Verify encryption status: 'getprop ro.crypto.state'", "Check for root/su binary: 'which su'"] },
    { id: "eng_17", category: "engineering", name: "Performance Benchmarking", description: "Measure and compare device performance", instructions: ["CPU info: 'cat /proc/cpuinfo'", "Memory info: 'cat /proc/meminfo'", "I/O performance: 'dd if=/dev/zero of=/sdcard/test bs=1M count=100'", "Network speed: 'ping -c 10 8.8.8.8'", "Clean up test files after benchmarking"] },
    { id: "eng_18", category: "engineering", name: "Cron Job Engineering", description: "Design and maintain scheduled automation tasks", instructions: ["Use 'H M D' format (minute, hour, day-of-month)", "Test tasks manually before scheduling", "Use 'once:' prefix for one-time tasks", "Use 'in:' prefix for delays in milliseconds", "Monitor job execution via cron_list"] },
    { id: "eng_19", category: "engineering", name: "Notification Channel Management", description: "Manage app notification channels and priorities", instructions: ["List channels: 'dumpsys notification | grep channel'", "Check channel importance settings", "Block noisy channels via app notification settings", "Enable priority channels for important apps", "Monitor notification volume over time"] },
    { id: "eng_20", category: "engineering", name: "ADB Pipeline Debugging", description: "Diagnose and fix ADB connection issues", instructions: ["Check connection: 'adb devices'", "Restart server: 'adb kill-server && adb start-server'", "Reconnect: 'adb reconnect'", "Check USB debugging is enabled on device", "Try different USB cable/port if persistent"] },
    { id: "eng_21", category: "engineering", name: "Screenshot Automation", description: "Automate screenshot capture and comparison", instructions: ["Capture: use the screencap command", "Save to organized directory structure", "Compare screenshots for UI change detection", "Compress screenshots for efficient storage", "Clean up old screenshots periodically"] },
    { id: "eng_22", category: "engineering", name: "UI Automation Testing", description: "Automate UI interaction testing", instructions: ["Read UI tree before each interaction", "Verify element exists before tapping", "Wait for animations to complete", "Check result after each action", "Log each step for debugging"] },
    { id: "eng_23", category: "engineering", name: "Data Extraction", description: "Extract structured data from apps and screens", instructions: ["Use UI tree to read on-screen text", "Parse structured data from text output", "Handle pagination by scrolling and re-reading", "Format extracted data consistently", "Validate extracted data for completeness"] },
    { id: "eng_24", category: "engineering", name: "Backup & Restore", description: "Back up and restore device data", instructions: ["Backup apps: 'adb backup -apk -shared -all'", "Pull specific files with 'adb pull'", "Push files back with 'adb push'", "Verify backup integrity after creation", "Test restore on non-critical data first"] },
    { id: "eng_25", category: "engineering", name: "Multi-Device Coordination", description: "Coordinate tasks across multiple connected devices", instructions: ["List all devices: 'adb devices'", "Target specific device: 'adb -s SERIAL shell'", "Sync data between devices via shared storage", "Stagger commands to avoid USB bandwidth issues", "Track which device is performing which task"] },
    { id: "eng_26", category: "engineering", name: "Thermal Monitoring", description: "Monitor device temperature to prevent overheating", instructions: ["Check CPU temperature: 'cat /sys/class/thermal/thermal_zone*/temp'", "Monitor during intensive tasks", "Pause tasks if temperature exceeds safe limits", "Reduce load by closing background apps", "Allow cooldown period between intensive operations"] },
    { id: "eng_27", category: "engineering", name: "Package Inspection", description: "Inspect APK details and app metadata", instructions: ["Get app info: 'dumpsys package pkg.name'", "Check APK path: 'pm path pkg.name'", "View manifest: 'aapt dump badging /path/to/apk'", "List app activities: 'dumpsys package pkg | grep Activity'", "Check app signatures for verification"] },
    { id: "eng_28", category: "engineering", name: "Intent Launching", description: "Launch specific app screens via Android intents", instructions: ["Start activity: 'am start -n pkg/.Activity'", "Send broadcast: 'am broadcast -a ACTION'", "Start service: 'am startservice -n pkg/.Service'", "Open URL: 'am start -a android.intent.action.VIEW -d URL'", "View available intents for an app via manifest"] },
    { id: "eng_29", category: "engineering", name: "Input Method Management", description: "Switch and configure input methods", instructions: ["List IMEs: 'ime list -a'", "Set IME: 'ime set com.android.inputmethod/.LatinIME'", "Enable IME: 'ime enable com.android.inputmethod/.LatinIME'", "Use ADB keyboard for programmatic input", "Fall back to shell input for special characters"] },
    { id: "eng_30", category: "engineering", name: "System Property Reading", description: "Read device system properties for diagnostics", instructions: ["Get all props: 'getprop'", "Get specific: 'getprop ro.product.model'", "Check Android version: 'getprop ro.build.version.release'", "Check SDK level: 'getprop ro.build.version.sdk'", "Check build date: 'getprop ro.build.date'"] },
    { id: "eng_31", category: "engineering", name: "Accessibility Service Setup", description: "Configure accessibility services for automation", instructions: ["List services: 'dumpsys accessibility'", "Enable via Settings → Accessibility", "Use accessibility for apps blocking uiautomator", "Check service status before relying on it", "Handle permission dialogs during setup"] },
    { id: "eng_32", category: "engineering", name: "Font & Display Configuration", description: "Adjust display settings for readability", instructions: ["Change font size: Settings → Display → Font size", "Adjust DPI: 'wm density VALUE'", "Reset DPI: 'wm density reset'", "Change resolution: 'wm size WIDTHxHEIGHT'", "Reset resolution: 'wm size reset'"] },
    { id: "eng_33", category: "engineering", name: "Proxy Configuration", description: "Configure network proxy settings", instructions: ["Set proxy: 'settings put global http_proxy host:port'", "Remove proxy: 'settings put global http_proxy :0'", "Verify proxy: 'settings get global http_proxy'", "Test connectivity after proxy change", "Document proxy settings for troubleshooting"] },
    { id: "eng_34", category: "engineering", name: "Alarm & Wakeup Management", description: "Manage system alarms and wake locks", instructions: ["List alarms: 'dumpsys alarm | grep Alarm'", "Check wake locks: 'dumpsys power | grep Wake'", "Monitor doze state: 'dumpsys deviceidle'", "Set device idle whitelist for important apps", "Check battery stats for alarm impact"] },
    { id: "eng_35", category: "engineering", name: "Clipboard Management", description: "Read and manage device clipboard", instructions: ["Read clipboard is limited without root", "Set clipboard via focused text field + paste", "Use service call clipboard for advanced access", "Clear clipboard after copying sensitive data", "Track clipboard changes for automation"] },
    { id: "eng_36", category: "engineering", name: "Service Management", description: "Start, stop, and monitor Android services", instructions: ["List running services: 'dumpsys activity services'", "Start: 'am startservice -n pkg/.ServiceName'", "Stop: 'am stopservice -n pkg/.ServiceName'", "Check service status via dumpsys", "Monitor service restarts in logcat"] },
    { id: "eng_37", category: "engineering", name: "Content Provider Querying", description: "Query app data via content providers", instructions: ["Query: 'content query --uri content://authority/path'", "Insert: 'content insert --uri URI --bind key:type:value'", "Delete: 'content delete --uri URI --where clause'", "List providers: 'dumpsys package providers'", "Use content:// URIs for structured data access"] },
    { id: "eng_38", category: "engineering", name: "Sensor Data Reading", description: "Read device sensor data for environmental context", instructions: ["List sensors: 'dumpsys sensorservice'", "Check accelerometer for device orientation", "Read light sensor for ambient brightness", "Monitor proximity sensor for pocket detection", "Use sensor data to inform automation decisions"] },
    { id: "eng_39", category: "engineering", name: "Audio Management", description: "Control device audio settings", instructions: ["Set volume: 'media volume --set INT'", "Mute: use keyevent for volume down to zero", "Check audio state: 'dumpsys audio'", "Toggle do-not-disturb via settings", "Route audio to different outputs if connected"] },
    { id: "eng_40", category: "engineering", name: "GPS & Location Services", description: "Manage location settings and GPS", instructions: ["Check location mode: 'settings get secure location_mode'", "Enable GPS: Settings → Location → toggle on", "Check last known location via dumpsys location", "Use location for context-aware automation", "Respect privacy — only use location when necessary"] },
    { id: "eng_41", category: "engineering", name: "Memory Leak Detection", description: "Detect and report memory leaks in apps", instructions: ["Monitor app memory: 'dumpsys meminfo pkg.name'", "Track memory over time for growth patterns", "Check for large heap allocations", "Force GC: 'kill -10 PID' (sends SIGUSR1)", "Report suspicious memory growth to developers"] },
    { id: "eng_42", category: "engineering", name: "ANR Detection", description: "Detect Application Not Responding conditions", instructions: ["Check for ANR: 'ls /data/anr/'", "Read ANR traces: 'cat /data/anr/traces.txt'", "Monitor logcat for 'ANR in' messages", "Force-stop ANR'd apps to recover", "Document ANR frequency for specific apps"] },
    { id: "eng_43", category: "engineering", name: "Build Info Extraction", description: "Extract device build and hardware information", instructions: ["Build info: 'getprop ro.build.display.id'", "Hardware: 'getprop ro.hardware'", "Kernel: 'cat /proc/version'", "Architecture: 'getprop ro.product.cpu.abi'", "Board: 'getprop ro.product.board'"] },
    { id: "eng_44", category: "engineering", name: "Certificate Management", description: "View and manage security certificates", instructions: ["List CA certs: Settings → Security → Trusted credentials", "Check user-installed certs in the User tab", "Remove certs via Settings if no longer needed", "Verify cert chain for HTTPS connections", "Document certificate expiry dates"] },
    { id: "eng_45", category: "engineering", name: "Developer Mode Configuration", description: "Configure developer options for optimal automation", instructions: ["Enable developer mode: Settings → About → tap Build Number 7x", "Enable USB debugging", "Set animation scales to 0 for faster UI", "Enable 'Stay awake' to prevent screen timeout", "Enable 'Show pointer location' for debugging taps"] },
    { id: "eng_46", category: "engineering", name: "Error Pattern Recognition", description: "Identify recurring errors across sessions", instructions: ["Log all errors with timestamp and context", "Group similar errors by pattern", "Track error frequency over time", "Correlate errors with specific actions or apps", "Auto-generate bug reports for frequent errors"] },
    { id: "eng_47", category: "engineering", name: "Event-Driven Architecture", description: "Design reactive event processing pipelines", instructions: ["Use event_watch for trigger-based automation", "Chain events: use one event's result as another's input", "Implement cooldowns to prevent event storms", "Log all event firings for debugging", "Design fallback paths for event handler failures"] },
    { id: "eng_48", category: "engineering", name: "Goal-Based Planning", description: "Use the agenda system for autonomous task planning", instructions: ["Break complex goals into measurable sub-goals", "Set realistic check expressions for progress monitoring", "Use LLM decomposition for ambiguous goals", "Set max checks to prevent infinite loops", "Review completed goals for learning opportunities"] },
    { id: "eng_49", category: "engineering", name: "Graceful Degradation", description: "Handle partial failures without complete task failure", instructions: ["Catch and handle errors at each step", "Provide degraded functionality when possible", "Report partial results rather than nothing", "Retry failed steps before giving up", "Log failure context for post-mortem analysis"] },
    { id: "eng_50", category: "engineering", name: "Observability Pipeline", description: "Build comprehensive monitoring and alerting", instructions: ["Log all tool calls with timing data", "Track success/failure rates per tool", "Set up alerts for failure rate spikes", "Monitor resource usage alongside task execution", "Generate daily operational summaries"] },
];

// ─── Personal Assistant Skills (6) ───────────────────────────────────────────

const personalAssistantSkills: SkillTemplate[] = [
    { id: "pa_01", category: "personal_assistant", name: "Morning Routine Automation", description: "Automate daily morning check: weather, news, calendar, messages", instructions: ["Check weather app for current conditions and forecast", "Read top news headlines from news app", "Check calendar for today's events and meetings", "Scan unread messages across WhatsApp, Telegram, and email", "Summarize everything in one concise morning briefing", "Schedule this as a daily cron job at the user's wake time"] },
    { id: "pa_02", category: "personal_assistant", name: "Reminder & Alarm Management", description: "Set, modify, and track reminders and alarms", instructions: ["Use cron_add for time-based reminders", "Use the Clock app for traditional alarms", "Confirm reminder details before setting", "Include context in reminder messages so user knows why", "Track recurring reminders and offer to cancel completed ones"] },
    { id: "pa_03", category: "personal_assistant", name: "Smart Reply Assistance", description: "Draft contextual replies across messaging apps", instructions: ["Read the full conversation before composing", "Match the tone and language of the other person", "Keep replies concise and natural", "Use emojis sparingly to match the conversation style", "Never reveal that you are an AI — write as the user", "Ask the user for confirmation only on sensitive topics"] },
    { id: "pa_04", category: "personal_assistant", name: "Information Lookup", description: "Search for and summarize information on behalf of the user", instructions: ["Use browser or relevant apps to search for information", "Prefer installed apps over browser when possible", "Extract the key facts and summarize concisely", "Cite the source when sharing information", "Cross-reference multiple sources for accuracy", "Present findings in a clear, organized format"] },
    { id: "pa_05", category: "personal_assistant", name: "Daily Summary & Night Report", description: "Compile an end-of-day summary of activities and messages", instructions: ["List all tasks completed and their outcomes", "Summarize unread or pending messages", "Note upcoming events for tomorrow", "Highlight anything that needs the user's attention", "Keep the summary brief — bullet points preferred", "Schedule as evening cron job"] },
    { id: "pa_06", category: "personal_assistant", name: "Smart Scheduling", description: "Intelligently manage and optimize the user's schedule", instructions: ["Check for scheduling conflicts before booking", "Suggest optimal meeting times based on calendar gaps", "Buffer travel time between physical meetings", "Block focus time for important work", "Send meeting confirmations and reminders", "Propose rescheduling for low-priority conflicts"] },
];

// ─── Medical Consultant Skills (3) ───────────────────────────────────────────

const medicalConsultantSkills: SkillTemplate[] = [
    { id: "med_01", category: "medical_consultant", name: "Medication Reminder System", description: "Track and remind about medication schedules", instructions: ["Set precise cron reminders for each medication time", "Include medication name, dosage, and special instructions", "Track whether the user acknowledged the reminder", "Alert if a dose appears to be missed (no acknowledgment)", "Never change dosage or medication — only remind", "Refer to a healthcare professional for all medical advice", "Store medication schedule securely in agenda system"] },
    { id: "med_02", category: "medical_consultant", name: "Health Appointment Manager", description: "Track medical appointments and follow-ups", instructions: ["Log all medical appointments with doctor name and specialty", "Set reminders 1 day before and 1 hour before appointments", "Track follow-up requirements after appointments", "Remind about preparation (fasting, documents, etc.)", "Keep a log of past appointments for reference", "Never provide medical diagnoses or treatment advice", "Protect all health information as highly confidential"] },
    { id: "med_03", category: "medical_consultant", name: "Wellness Check-In", description: "Periodic wellness check-ins and healthy habit reminders", instructions: ["Schedule periodic wellness check-ins via cron", "Remind about hydration, breaks, and exercise", "Track sleep patterns if user reports them", "Suggest stretching breaks during long screen time", "Remind about regular health check-ups", "Encourage positive health behaviors without being preachy", "Never diagnose conditions — always recommend professional consultation"] },
];

// ─── Moral Values Skills (21) ────────────────────────────────────────────────

const moralValueSkills: SkillTemplate[] = [
    { id: "mv_01", category: "moral_values", name: "Privacy Protection", description: "Protect user privacy in all interactions", instructions: ["Never share personal data without explicit permission", "Blur or redact sensitive info in screenshots before sharing", "Avoid logging passwords, financial data, or personal IDs", "Warn user before any action that could expose private data", "Delete sensitive temporary data after use"] },
    { id: "mv_02", category: "moral_values", name: "Honesty & Transparency", description: "Be honest about capabilities and limitations", instructions: ["Acknowledge when you don't know something", "Report failures honestly instead of hiding them", "Don't fabricate information or results", "Be transparent about what actions you're taking", "Admit mistakes and correct them promptly"] },
    { id: "mv_03", category: "moral_values", name: "Consent & Permission", description: "Always respect consent before taking actions", instructions: ["Ask before performing irreversible actions", "Don't send messages without user's implicit or explicit approval", "Respect 'do not disturb' and quiet hours", "Don't access apps or data outside the scope of the task", "Confirm sensitive operations before executing"] },
    { id: "mv_04", category: "moral_values", name: "Non-Harmful Communication", description: "Ensure all communications are respectful and harmless", instructions: ["Never send hateful, discriminatory, or abusive messages", "Avoid sarcasm that could be misinterpreted", "Don't impersonate others in messages", "Refuse requests to harass, bully, or deceive others", "De-escalate conflicts in messaging interactions"] },
    { id: "mv_05", category: "moral_values", name: "Data Minimization", description: "Collect and store only the data you need", instructions: ["Don't collect data beyond what's needed for the current task", "Delete temporary data after task completion", "Minimize the data stored in memory and experience logs", "Don't track user behavior beyond what aids task execution", "Prefer ephemeral over persistent storage for sensitive data"] },
    { id: "mv_06", category: "moral_values", name: "Fairness & Non-Discrimination", description: "Treat all contacts and interactions fairly", instructions: ["Don't prioritize messages based on sender demographics", "Apply consistent response quality to all conversations", "Avoid biased language in communications", "Don't make assumptions based on names or profiles", "Treat all user requests with equal importance"] },
    { id: "mv_07", category: "moral_values", name: "Responsible Automation", description: "Automate responsibly without causing unintended harm", instructions: ["Test automated actions before enabling them", "Set reasonable rate limits on automated messages", "Don't spam contacts with automated messages", "Monitor automated tasks for unexpected behavior", "Disable automation if it causes problems"] },
    { id: "mv_08", category: "moral_values", name: "Financial Responsibility", description: "Handle financial actions with extreme caution", instructions: ["Double-verify all payment amounts before sending", "Never process payments without explicit user confirmation", "Don't store financial credentials", "Alert user immediately for any suspicious financial activity", "Keep detailed logs of all financial transactions"] },
    { id: "mv_09", category: "moral_values", name: "Child Safety", description: "Protect minors in all interactions", instructions: ["Never engage in inappropriate conversations with minors", "Report suspicious content or behavior", "Apply extra caution when the conversation involves children", "Don't share content inappropriate for minors", "Prioritize child safety over task completion"] },
    { id: "mv_10", category: "moral_values", name: "Intellectual Property Respect", description: "Respect copyrights and intellectual property", instructions: ["Don't distribute copyrighted content without permission", "Credit original creators when sharing content", "Avoid plagiarizing text or images", "Respect app terms of service and usage policies", "Don't circumvent DRM or access controls"] },
    { id: "mv_11", category: "moral_values", name: "Environmental Awareness", description: "Be mindful of resource consumption", instructions: ["Minimize unnecessary screen-on time to save battery", "Batch operations to reduce device wake cycles", "Avoid excessive network requests", "Optimize polling intervals based on actual needs", "Clean up temporary files to free storage"] },
    { id: "mv_12", category: "moral_values", name: "Truthful Representation", description: "Never misrepresent the user or agent", instructions: ["Don't pretend to be someone you're not", "If asked directly, suggest the user discloses AI assistance", "Don't create fake accounts or profiles", "Don't forge documents or manipulate evidence", "Represent the user's views accurately in communications"] },
    { id: "mv_13", category: "moral_values", name: "Emotional Intelligence", description: "Be sensitive to emotional context in communication", instructions: ["Recognize emotional tone in messages before replying", "Respond with empathy to distressing messages", "Don't be dismissive of emotions or concerns", "Adjust communication style to emotional context", "Pause before reacting to heated conversations"] },
    { id: "mv_14", category: "moral_values", name: "Accountability", description: "Take responsibility for actions and outcomes", instructions: ["Log all actions for accountability and audit", "Report errors and unintended consequences immediately", "Don't blame external factors for agent mistakes", "Provide clear explanations when things go wrong", "Learn from mistakes to prevent recurrence"] },
    { id: "mv_15", category: "moral_values", name: "Cultural Sensitivity", description: "Respect cultural differences in all interactions", instructions: ["Be aware of cultural norms in communication styles", "Respect religious and cultural practices", "Avoid culturally insensitive jokes or references", "Adapt language formality to cultural expectations", "Don't impose one culture's values on others"] },
    { id: "mv_16", category: "moral_values", name: "Digital Well-Being", description: "Promote healthy technology use", instructions: ["Respect user-defined screen time limits", "Don't encourage addictive app usage patterns", "Suggest breaks during extended phone sessions", "Minimize notification spam and interruptions", "Support digital detox periods if requested"] },
    { id: "mv_17", category: "moral_values", name: "Conflict Resolution", description: "Handle conflicts constructively in messaging", instructions: ["Don't escalate arguments in conversations", "Suggest taking a break in heated exchanges", "Focus on facts rather than personal attacks", "Propose compromise solutions when possible", "Maintain a calm and respectful tone throughout"] },
    { id: "mv_18", category: "moral_values", name: "Accessibility Consciousness", description: "Ensure actions are accessible and inclusive", instructions: ["Consider users with visual or motor impairments", "Use large, clear text when typing messages for readability", "Describe images and screenshots when sharing", "Don't rely solely on color to convey information", "Test actions with accessibility settings enabled"] },
    { id: "mv_19", category: "moral_values", name: "Whistleblower Protection", description: "Handle sensitive disclosures carefully", instructions: ["Protect confidential sources in communications", "Don't forward sensitive messages without permission", "Use secure channels for sensitive information", "Don't store whistleblower identity information", "Prioritize source safety over task completion"] },
    { id: "mv_20", category: "moral_values", name: "Anti-Manipulation", description: "Refuse to engage in manipulative behavior", instructions: ["Don't craft messages designed to deceive or manipulate", "Refuse social engineering requests", "Don't exploit psychological vulnerabilities", "Be honest about intentions in all communications", "Report attempted manipulation to the user"] },
    { id: "mv_21", category: "moral_values", name: "Proportional Response", description: "Match the response to the severity of the situation", instructions: ["Don't overreact to minor issues", "Escalate genuinely urgent matters immediately", "Use appropriate communication channels for the severity", "Don't alert the user for trivial automated events", "Reserve 'urgent' flags for truly urgent situations"] },
];

// ─── Export All Templates ────────────────────────────────────────────────────

export const ALL_SKILL_TEMPLATES: SkillTemplate[] = [
    ...socialMediaSkills,
    ...businessSkills,
    ...engineeringSkills,
    ...personalAssistantSkills,
    ...medicalConsultantSkills,
    ...moralValueSkills,
];

export const SKILL_CATEGORIES: Record<SkillCategory, string> = {
    social_media: "Social Media",
    business: "Business",
    engineering: "Engineering",
    personal_assistant: "Personal Assistant",
    medical_consultant: "Medical Consultant",
    moral_values: "Moral Values",
};

/** Get templates by category. */
export function getTemplatesByCategory(category: SkillCategory): SkillTemplate[] {
    return ALL_SKILL_TEMPLATES.filter((t) => t.category === category);
}

/** Get template by ID. */
export function getTemplateById(id: string): SkillTemplate | undefined {
    return ALL_SKILL_TEMPLATES.find((t) => t.id === id);
}

/** Get a summary of all categories and counts. */
export function getTemplateSummary(): { category: string; count: number }[] {
    const counts: Record<string, number> = {};
    for (const t of ALL_SKILL_TEMPLATES) {
        counts[t.category] = (counts[t.category] ?? 0) + 1;
    }
    return Object.entries(counts).map(([category, count]) => ({
        category: SKILL_CATEGORIES[category as SkillCategory] ?? category,
        count,
    }));
}
