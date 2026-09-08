---
name: iny-kb-formatter
description: >-
  Use this skill when the user wants to convert a raw text dump (.txt file or pasted text) into a properly structured Markdown file for Iny's RAG knowledge base. It handles extracting missing details, formatting for optimal chunking, and ingesting the file.
---

# Iny Knowledge Base Formatter

This skill is designed to take unstructured "brain dumps" (from `.txt` files or chat messages) and turn them into highly structured, LLM-friendly Markdown documents that fit perfectly into Iny's hybrid-search RAG pipeline.

Follow these steps precisely:

## Step 1: Analyze the Input

Read the raw text provided by the user. Evaluate it against the needs of a college student asking a chatbot:
- **Are roles clearly defined?** (e.g., if there's a name and email, what is this person in charge of?)
- **Is the scope clear?** (e.g., if it's a menu, which week/month is it for? If it's a procedure, who does it apply to?)
- **Are there implicit acronyms or terms?** (SST students might know them, but explicitly spelling them out helps semantic search).

## Step 2: Ask for Clarification (If needed)

If the raw text is missing crucial context, **stop and ask the user**. 
*Example: "I see you provided a list of names and emails for the tech team, but you didn't specify who handles hardware vs. software requests. Should I add that distinction so Iny can route questions better?"*

If the text is sufficient, proceed to Step 3.

## Step 3: Format into Markdown

Create a `.md` file inside the `docs/` folder (e.g., `docs/tech-team-pocs.md`). 

**Formatting Rules for Optimal Chunker Performance:**
1. **Title:** Must have a clear `# H1 Header` at the top. The ingestion parser uses this as the document title.
2. **Chunking Boundaries:** Use `## H2 Headers` to separate distinct concepts. Iny's chunker treats `##` as logical break points and preserves them as breadcrumbs (e.g., `Tech Team > Hardware Issues`).
3. **Clarity:** Use bullet points and `**bold**` text for key names, limits, dates, or emails.
4. **No Fluff:** Remove conversational filler from the raw dump. Make it sound like an official reference document.

*Example formatting:*
```markdown
# Campus Tech Support POCs

## Hardware Issues
Contact these people for broken laptops, lab equipment, or physical network issues:
- **John Doe** (john.doe@sst.edu) - Hardware Lead
- **Jane Smith** (jane.smith@sst.edu) - Lab Technician

## Software Issues
Contact these people for account lockouts, software licenses, or portal access:
- **Helpdesk Team** (it-help@sst.edu) - General inquiries
```

## Step 4: Ingest into the Database

Once the Markdown file is created and saved in `docs/`:
1. Run the ingestion pipeline from the project root:
   `npm run ingest`
2. Verify the output says `chunks created` and no database connection errors occurred.
3. Inform the user that the knowledge base has been successfully updated and Iny is now aware of the new information!
