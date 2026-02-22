/**
 * Google Classroom API tools.
 * View courses, assignments, and coursework.
 */
import { simpleGet } from "./api-client.js";
import type { ToolDefinition } from "../agent/tool-registry.js";

const BASE = "https://classroom.googleapis.com/v1";

export const classroomTools: ToolDefinition[] = [
    {
        name: "classroom_courses",
        description: "List your Google Classroom courses.",
        parameters: {
            type: "object",
            properties: {
                state: { type: "string", description: "Filter by state: ACTIVE or ARCHIVED", enum: ["ACTIVE", "ARCHIVED"] },
            },
            required: [],
        },
        execute: async (args) => {
            try {
                let url = `${BASE}/courses?pageSize=20`;
                if (args.state) url += `&courseStates=${args.state}`;
                const data = await simpleGet(url);
                if (!data.courses?.length) return { type: "text", content: "No courses found." };
                const rows = data.courses.map((c: any, i: number) =>
                    `${i + 1}. **${c.name}**${c.section ? ` (${c.section})` : ""} — ${c.courseState} [id:${c.id}]`
                );
                return { type: "text", content: `🎓 Courses:\n${rows.join("\n")}` };
            } catch (e: any) { return { type: "text", content: `Error: ${e.message}` }; }
        },
    },
    {
        name: "classroom_work",
        description: "List coursework/assignments for a course.",
        parameters: {
            type: "object",
            properties: {
                courseId: { type: "string", description: "Course ID" },
            },
            required: ["courseId"],
        },
        execute: async (args) => {
            try {
                const data = await simpleGet(`${BASE}/courses/${args.courseId}/courseWork?pageSize=20`);
                if (!data.courseWork?.length) return { type: "text", content: "No coursework found." };
                const rows = data.courseWork.map((w: any, i: number) => {
                    const due = w.dueDate ? `${w.dueDate.month}/${w.dueDate.day}/${w.dueDate.year}` : "No due date";
                    return `${i + 1}. **${w.title}** (${w.workType}) — Due: ${due} [id:${w.id}]`;
                });
                return { type: "text", content: `📝 Coursework:\n${rows.join("\n")}` };
            } catch (e: any) { return { type: "text", content: `Error: ${e.message}` }; }
        },
    },
    {
        name: "classroom_submissions",
        description: "View your submissions for a coursework item.",
        parameters: {
            type: "object",
            properties: {
                courseId: { type: "string", description: "Course ID" },
                courseworkId: { type: "string", description: "Coursework ID" },
            },
            required: ["courseId", "courseworkId"],
        },
        execute: async (args) => {
            try {
                const data = await simpleGet(
                    `${BASE}/courses/${args.courseId}/courseWork/${args.courseworkId}/studentSubmissions?pageSize=20`
                );
                if (!data.studentSubmissions?.length) return { type: "text", content: "No submissions found." };
                const rows = data.studentSubmissions.map((s: any, i: number) =>
                    `${i + 1}. State: ${s.state} | Grade: ${s.assignedGrade ?? "Not graded"} | Late: ${s.late ? "Yes" : "No"}`
                );
                return { type: "text", content: `📋 Submissions:\n${rows.join("\n")}` };
            } catch (e: any) { return { type: "text", content: `Error: ${e.message}` }; }
        },
    },
];
