import { plainTextToResumeData } from "../resume-text.js";

const tiny = `PROFESSIONAL EXPERIENCE
Intrado

Senior Salesforce Engineer
Jun 2024 – Present
Colorado, United States | Remote

Enterprise Public-Safety Customer and Service Operations

Own Salesforce enhancements supporting enterprise account management.
Collaborate directly with sales stakeholders.
S&P Global

Salesforce Developer
Dec 2022 – May 2024
New York, New York, United States | Remote

Enterprise Sales and Client-Service Platform

Delivered Salesforce solutions supporting institutional customer relationships.
`;

console.log(JSON.stringify(plainTextToResumeData(tiny).experience, null, 2));
