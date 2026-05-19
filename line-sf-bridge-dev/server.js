const express = require("express");
const jsforce = require("jsforce");

const app = express();
app.use(express.json({ limit: "10mb" }));

const oauth2 = new jsforce.OAuth2({
  loginUrl: "https://test.salesforce.com",
  clientId: process.env.SF_CLIENT_ID,
  clientSecret: process.env.SF_CLIENT_SECRET,
  redirectUri: "https://line-sf-bridge-dev-382d57e13f70.herokuapp.com/oauth/callback"
});

function getSalesforceConnection() {
  return new jsforce.Connection({
    oauth2,
    instanceUrl: process.env.SF_INSTANCE_URL,
    refreshToken: process.env.SF_REFRESH_TOKEN
  });
}

async function sendLineMessage(lineUserId, text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!token) {
    throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not set");
  }

  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      to: lineUserId,
      messages: [
        {
          type: "text",
          text
        }
      ]
    })
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`LINE push failed: ${response.status} ${responseText}`);
  }

  return responseText;
}

async function getLineProfile(lineUserId) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  const response = await fetch(
    `https://api.line.me/v2/bot/profile/${lineUserId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  if (!response.ok) {
    console.error("LINE profile fetch failed:", response.status, await response.text());
    return null;
  }

  return await response.json();
}

async function findOrCreateContact(conn, lineUserId) {
  if (!lineUserId) return null;

  const profile = await getLineProfile(lineUserId);

  const contacts = await conn
    .sobject("Contact")
    .find({ LINEUserId__c: lineUserId }, ["Id"])
    .limit(1);

  if (contacts.length > 0) {
    const updateData = {
      Id: contacts[0].Id,
      LINEUserId__c: lineUserId
    };

    if (profile) {
      updateData.LINEDisplayName__c = profile.displayName || null;
      updateData.LINEPictureUrl__c = profile.pictureUrl || null;
    }

    await conn.sobject("Contact").update(updateData);

    return contacts[0].Id;
  }

  const created = await conn.sobject("Contact").create({
    LastName: profile?.displayName || `LINEユーザー_${lineUserId.slice(-6)}`,
    LINEUserId__c: lineUserId,
    LINEDisplayName__c: profile?.displayName || null,
    LINEPictureUrl__c: profile?.pictureUrl || null
  });

  return created.id;
}

async function findOrCreateConversation(conn, contactId) {
  if (!contactId) return null;

  const existing = await conn.query(`
    SELECT Id
    FROM LINE_Conversation__c
    WHERE Contact__c = '${contactId}'
    LIMIT 1
  `);

  if (existing.records.length > 0) {
    return existing.records[0].Id;
  }

  const created = await conn.sobject("LINE_Conversation__c").create({
    Contact__c: contactId,
    Status__c: "Open",
    LastMessageAt__c: new Date().toISOString()
  });

  return created.id;
}

app.get("/", (req, res) => {
  res.send("LINE Salesforce Bridge is running.");
});

app.get("/login", (req, res) => {
  res.redirect(
    oauth2.getAuthorizationUrl({
      scope: "api refresh_token"
    })
  );
});

app.get("/oauth/callback", async (req, res) => {
  const conn = new jsforce.Connection({ oauth2 });

  try {
    await conn.authorize(req.query.code);

    console.log("ACCESS TOKEN:", conn.accessToken);
    console.log("REFRESH TOKEN:", conn.refreshToken);
    console.log("INSTANCE URL:", conn.instanceUrl);

    res.send("Salesforce OAuth Success");
  } catch (err) {
    console.error("OAuth error:", err);
    res.status(500).send(err.message);
  }
});

app.post("/webhook", async (req, res) => {
  console.log("=== WEBHOOK RECEIVED ===");
  console.log(JSON.stringify(req.body, null, 2));
  console.log("=== END WEBHOOK ===");

  try {
    const conn = getSalesforceConnection();
    const events = req.body.events || [];

    for (const event of events) {
      if (event.type !== "message") continue;

      const message = event.message || {};
      const source = event.source || {};
      const lineUserId = source.userId || null;

      const contactId = await findOrCreateContact(conn, lineUserId);
      const conversationId = await findOrCreateConversation(conn, contactId);

      if (conversationId) {
        await conn.sobject("LINE_Conversation__c").update({
          Id: conversationId,
          LastMessageAt__c: new Date(event.timestamp).toISOString(),
          LastMessageText__c:
            message.type === "text"
                ? message.text
                : `[${message.type}メッセージ]`,

            IsUnread__c: true,
            IsWaitingReply__c: true,
        });
      }

      const record = {
        Direction__c: "Inbound",
        MessageText__c:
            message.type === "text"
              ? message.text
              : `[${message.type}メッセージ]`,
        MessageType__c: message.type,
        LineMessageId__c: message.id,
        LineUserId__c: lineUserId,
        SentAt__c: new Date(event.timestamp).toISOString(),
        HasAttachment__c: message.type !== "text",
        LineContentId__c: message.type !== "text" ? message.id : null
     };

      if (contactId) {
        record.Contact__c = contactId;
      }

      if (conversationId) {
        record.Conversation__c = conversationId;
      }

      const result = await conn.sobject("LINE_Message__c").create(record);
      console.log("Salesforce inbound create result:", result);
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Salesforce save error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/send", async (req, res) => {
  try {
    const { lineUserId, text } = req.body;

    if (!lineUserId || !text) {
      return res.status(400).json({
        ok: false,
        error: "lineUserId and text are required"
      });
    }

    await sendLineMessage(lineUserId, text);

    res.status(200).json({
      ok: true,
      message: "LINE message sent"
    });
  } catch (err) {
    console.error("LINE send error:", err);
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

app.post("/send-from-salesforce", async (req, res) => {
  try {
    const { conversationId, text } = req.body;

    if (!conversationId) {
      return res.status(400).json({
        ok: false,
        error: "conversationId is required"
      });
    }

    if (!text) {
      return res.status(400).json({
        ok: false,
        error: "text is required"
      });
    }

    const conn = getSalesforceConnection();

    const conversation = await conn
      .sobject("LINE_Conversation__c")
      .retrieve(conversationId);

    const contactId = conversation.Contact__c;

    if (!contactId) {
      return res.status(400).json({
        ok: false,
        error: "Contact__c is empty"
      });
    }

    const contact = await conn.sobject("Contact").retrieve(contactId);
    const lineUserId = contact.LINEUserId__c;

    if (!lineUserId) {
      return res.status(400).json({
        ok: false,
        error: "Contact.LINEUserId__c is empty"
      });
    }

    await sendLineMessage(lineUserId, text);

    const outboundMessage = await conn.sobject("LINE_Message__c").create({
      Direction__c: "Outbound",
      MessageType__c: "text",
      MessageText__c: text,
      LineUserId__c: lineUserId,
      SentAt__c: new Date().toISOString(),
      HasAttachment__c: false,
      Contact__c: contactId,
      Conversation__c: conversationId
    });

    await conn.sobject("LINE_Conversation__c").update({
      Id: conversationId,
      ReplyText__c: "",
      ReplySent__c: true,
      LastMessageAt__c: new Date().toISOString(),
      LastMessageText__c: text,
      IsUnread__c: false,
      IsWaitingReply__c: false,
    });

    res.status(200).json({
      ok: true,
      message: "LINE reply sent from Salesforce",
      outboundMessageId: outboundMessage.id
    });
  } catch (err) {
    console.error("Salesforce send error:", err);
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});