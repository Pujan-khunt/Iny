import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FoodAnnouncementsInboundAdapter } from '../../../../src/adapters/inbound/whatsapp/FoodAnnouncementsInboundAdapter.js';
import { whatsappGroupFoodAnnouncementsMessages } from '../../../../src/adapters/outbound/mess/postgres/schema.js';
import { LoggerPort } from '../../../../src/core/ports/LoggerPort.js';
import { WAMessage } from '@whiskeysockets/baileys';

describe('FoodAnnouncementsInboundAdapter', () => {
  const TARGET_GROUP_JID = '120363045678901234@g.us';

  let mockLogger: LoggerPort;
  let mockConn: { subscribe: ReturnType<typeof vi.fn> };
  let mockDb: { insert: ReturnType<typeof vi.fn> };
  let mockValues: ReturnType<typeof vi.fn>;
  let mockOnConflictDoNothing: ReturnType<typeof vi.fn>;
  let mockDownloadMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };

    mockConn = {
      subscribe: vi.fn(),
    };

    mockOnConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    mockValues = vi.fn().mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing });
    mockDb = {
      insert: vi.fn().mockReturnValue({ values: mockValues }),
    };

    mockDownloadMedia = vi.fn().mockResolvedValue(Buffer.from('fake-media-bytes'));
  });

  it('ignores messages from non-target groups and messages where fromMe is true', async () => {
    const adapter = new FoodAnnouncementsInboundAdapter({
      targetGroupJid: TARGET_GROUP_JID,
      db: mockDb as any,
      connectionManager: mockConn as any,
      logger: mockLogger,
      downloadMedia: mockDownloadMedia as any,
    });

    adapter.start();
    expect(mockConn.subscribe).toHaveBeenCalledWith('messages.upsert', expect.any(Function));

    const handler = mockConn.subscribe.mock.calls[0][1];

    // Self message
    await handler({ messages: [{ key: { remoteJid: TARGET_GROUP_JID, fromMe: true } }] });
    expect(mockDb.insert).not.toHaveBeenCalled();

    // Wrong group
    await handler({ messages: [{ key: { remoteJid: 'other@g.us', fromMe: false } }] });
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('ignores messages with missing id or missing participant', async () => {
    const adapter = new FoodAnnouncementsInboundAdapter({
      targetGroupJid: TARGET_GROUP_JID,
      db: mockDb as any,
      connectionManager: mockConn as any,
      logger: mockLogger,
      downloadMedia: mockDownloadMedia as any,
    });

    adapter.start();
    const handler = mockConn.subscribe.mock.calls[0][1];

    // Missing id
    await handler({
      messages: [
        {
          key: { remoteJid: TARGET_GROUP_JID, fromMe: false },
          message: { conversation: 'Missing ID' },
          participant: '919876543210@s.whatsapp.net',
        },
      ],
    });
    expect(mockDb.insert).not.toHaveBeenCalled();

    // Missing participant
    await handler({
      messages: [
        {
          key: { id: 'msg-no-part', remoteJid: TARGET_GROUP_JID, fromMe: false },
          message: { conversation: 'Missing participant' },
        },
      ],
    });
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('ingests plain text message and normalizes PN sender address', async () => {
    const adapter = new FoodAnnouncementsInboundAdapter({
      targetGroupJid: TARGET_GROUP_JID,
      db: mockDb as any,
      connectionManager: mockConn as any,
      logger: mockLogger,
      downloadMedia: mockDownloadMedia as any,
    });

    adapter.start();
    const handler = mockConn.subscribe.mock.calls[0][1];

    const rawMsg: WAMessage = {
      key: {
        id: 'wamid-txt-1',
        remoteJid: TARGET_GROUP_JID,
        fromMe: false,
        participant: '919876543210:4@s.whatsapp.net',
      },
      message: {
        conversation: 'Lunch today will be served in Dining Hall A',
      },
    };

    await handler({ messages: [rawMsg] });

    expect(mockDb.insert).toHaveBeenCalledWith(whatsappGroupFoodAnnouncementsMessages);
    expect(mockValues).toHaveBeenCalledWith({
      id: 'wamid-txt-1',
      senderAddress: '919876543210@s.whatsapp.net',
      senderAddressType: 'pn',
      messageType: 'text',
      textBody: 'Lunch today will be served in Dining Hall A',
      mediaMimeType: null,
      mediaBuffer: null,
      status: 'pending',
    });
    expect(mockOnConflictDoNothing).toHaveBeenCalled();
    expect(mockDownloadMedia).not.toHaveBeenCalled();
  });

  it('ingests extended text message and normalizes LID sender address', async () => {
    const adapter = new FoodAnnouncementsInboundAdapter({
      targetGroupJid: TARGET_GROUP_JID,
      db: mockDb as any,
      connectionManager: mockConn as any,
      logger: mockLogger,
      downloadMedia: mockDownloadMedia as any,
    });

    adapter.start();
    const handler = mockConn.subscribe.mock.calls[0][1];

    const rawMsg: WAMessage = {
      key: {
        id: 'wamid-txt-lid',
        remoteJid: TARGET_GROUP_JID,
        fromMe: false,
      },
      participant: '123456789012345:1@lid',
      message: {
        extendedTextMessage: {
          text: 'Special dessert: Gulab Jamun tonight!',
        },
      },
    };

    await handler({ messages: [rawMsg] });

    expect(mockDb.insert).toHaveBeenCalledWith(whatsappGroupFoodAnnouncementsMessages);
    expect(mockValues).toHaveBeenCalledWith({
      id: 'wamid-txt-lid',
      senderAddress: '123456789012345@lid',
      senderAddressType: 'lid',
      messageType: 'text',
      textBody: 'Special dessert: Gulab Jamun tonight!',
      mediaMimeType: null,
      mediaBuffer: null,
      status: 'pending',
    });
    expect(mockOnConflictDoNothing).toHaveBeenCalled();
  });

  it('ingests image message, downloads media buffer, and saves caption', async () => {
    const fakeImageBuffer = Buffer.from('fake-jpeg-binary-data');
    mockDownloadMedia.mockResolvedValue(fakeImageBuffer);

    const adapter = new FoodAnnouncementsInboundAdapter({
      targetGroupJid: TARGET_GROUP_JID,
      db: mockDb as any,
      connectionManager: mockConn as any,
      logger: mockLogger,
      downloadMedia: mockDownloadMedia as any,
    });

    adapter.start();
    const handler = mockConn.subscribe.mock.calls[0][1];

    const rawMsg: WAMessage = {
      key: {
        id: 'wamid-img-1',
        remoteJid: TARGET_GROUP_JID,
        fromMe: false,
        participant: '919876543210@s.whatsapp.net',
      },
      message: {
        imageMessage: {
          mimetype: 'image/jpeg',
          caption: 'Notice: Change in breakfast timings',
        },
      },
    };

    await handler({ messages: [rawMsg] });

    expect(mockDownloadMedia).toHaveBeenCalledWith(rawMsg, 'buffer', {});
    expect(mockDb.insert).toHaveBeenCalledWith(whatsappGroupFoodAnnouncementsMessages);
    expect(mockValues).toHaveBeenCalledWith({
      id: 'wamid-img-1',
      senderAddress: '919876543210@s.whatsapp.net',
      senderAddressType: 'pn',
      messageType: 'image',
      textBody: 'Notice: Change in breakfast timings',
      mediaMimeType: 'image/jpeg',
      mediaBuffer: fakeImageBuffer,
      status: 'pending',
    });
    expect(mockOnConflictDoNothing).toHaveBeenCalled();
  });

  it('ingests document message, downloads buffer, and uses fileName if caption is absent', async () => {
    const fakePdfBuffer = Buffer.from('%PDF-1.4 fake pdf data');
    mockDownloadMedia.mockResolvedValue(fakePdfBuffer);

    const adapter = new FoodAnnouncementsInboundAdapter({
      targetGroupJid: TARGET_GROUP_JID,
      db: mockDb as any,
      connectionManager: mockConn as any,
      logger: mockLogger,
      downloadMedia: mockDownloadMedia as any,
    });

    adapter.start();
    const handler = mockConn.subscribe.mock.calls[0][1];

    const rawMsg: WAMessage = {
      key: {
        id: 'wamid-doc-1',
        remoteJid: TARGET_GROUP_JID,
        fromMe: false,
        participant: '919876543210@s.whatsapp.net',
      },
      message: {
        documentMessage: {
          mimetype: 'application/pdf',
          fileName: 'October_Mess_Menu_Week_2.pdf',
        },
      },
    };

    await handler({ messages: [rawMsg] });

    expect(mockDownloadMedia).toHaveBeenCalledWith(rawMsg, 'buffer', {});
    expect(mockValues).toHaveBeenCalledWith({
      id: 'wamid-doc-1',
      senderAddress: '919876543210@s.whatsapp.net',
      senderAddressType: 'pn',
      messageType: 'document',
      textBody: 'October_Mess_Menu_Week_2.pdf',
      mediaMimeType: 'application/pdf',
      mediaBuffer: fakePdfBuffer,
      status: 'pending',
    });
    expect(mockOnConflictDoNothing).toHaveBeenCalled();
  });

  it('unwraps container messages (e.g. ephemeral or view-once)', async () => {
    const fakeBuffer = Buffer.from('ephemeral-image');
    mockDownloadMedia.mockResolvedValue(fakeBuffer);

    const adapter = new FoodAnnouncementsInboundAdapter({
      targetGroupJid: TARGET_GROUP_JID,
      db: mockDb as any,
      connectionManager: mockConn as any,
      logger: mockLogger,
      downloadMedia: mockDownloadMedia as any,
    });

    adapter.start();
    const handler = mockConn.subscribe.mock.calls[0][1];

    const rawMsg: WAMessage = {
      key: {
        id: 'wamid-ephem-1',
        remoteJid: TARGET_GROUP_JID,
        fromMe: false,
        participant: '919876543210@s.whatsapp.net',
      },
      message: {
        ephemeralMessage: {
          message: {
            imageMessage: {
              mimetype: 'image/png',
              caption: 'Ephemeral menu update',
            },
          },
        },
      },
    };

    await handler({ messages: [rawMsg] });

    expect(mockValues).toHaveBeenCalledWith({
      id: 'wamid-ephem-1',
      senderAddress: '919876543210@s.whatsapp.net',
      senderAddressType: 'pn',
      messageType: 'image',
      textBody: 'Ephemeral menu update',
      mediaMimeType: 'image/png',
      mediaBuffer: fakeBuffer,
      status: 'pending',
    });
  });

  it('handles media download failures gracefully and stores null buffer', async () => {
    mockDownloadMedia.mockRejectedValue(new Error('Media download timed out or expired'));

    const adapter = new FoodAnnouncementsInboundAdapter({
      targetGroupJid: TARGET_GROUP_JID,
      db: mockDb as any,
      connectionManager: mockConn as any,
      logger: mockLogger,
      downloadMedia: mockDownloadMedia as any,
    });

    adapter.start();
    const handler = mockConn.subscribe.mock.calls[0][1];

    const rawMsg: WAMessage = {
      key: {
        id: 'wamid-img-fail',
        remoteJid: TARGET_GROUP_JID,
        fromMe: false,
        participant: '919876543210@s.whatsapp.net',
      },
      message: {
        imageMessage: {
          mimetype: 'image/jpeg',
          caption: 'Menu with expired media',
        },
      },
    };

    await handler({ messages: [rawMsg] });

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to download media for food announcement message',
      expect.any(Error),
      expect.objectContaining({ messageId: 'wamid-img-fail' })
    );

    expect(mockDb.insert).toHaveBeenCalledWith(whatsappGroupFoodAnnouncementsMessages);
    expect(mockValues).toHaveBeenCalledWith({
      id: 'wamid-img-fail',
      senderAddress: '919876543210@s.whatsapp.net',
      senderAddressType: 'pn',
      messageType: 'image',
      textBody: 'Menu with expired media',
      mediaMimeType: 'image/jpeg',
      mediaBuffer: null,
      status: 'pending',
    });
    expect(mockOnConflictDoNothing).toHaveBeenCalled();
  });

  it('ignores unsupported message types such as audio or reactions', async () => {
    const adapter = new FoodAnnouncementsInboundAdapter({
      targetGroupJid: TARGET_GROUP_JID,
      db: mockDb as any,
      connectionManager: mockConn as any,
      logger: mockLogger,
      downloadMedia: mockDownloadMedia as any,
    });

    adapter.start();
    const handler = mockConn.subscribe.mock.calls[0][1];

    const audioMsg: WAMessage = {
      key: {
        id: 'wamid-audio-1',
        remoteJid: TARGET_GROUP_JID,
        fromMe: false,
        participant: '919876543210@s.whatsapp.net',
      },
      message: {
        audioMessage: {
          mimetype: 'audio/ogg; codecs=opus',
        },
      },
    };

    await handler({ messages: [audioMsg] });

    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDownloadMedia).not.toHaveBeenCalled();
  });

  it('catches database insertion errors and continues processing subsequent messages', async () => {
    const dbError = new Error('Database connection failed');
    mockOnConflictDoNothing.mockRejectedValueOnce(dbError).mockResolvedValueOnce(undefined);

    const adapter = new FoodAnnouncementsInboundAdapter({
      targetGroupJid: TARGET_GROUP_JID,
      db: mockDb as any,
      connectionManager: mockConn as any,
      logger: mockLogger,
      downloadMedia: mockDownloadMedia as any,
    });

    adapter.start();
    const handler = mockConn.subscribe.mock.calls[0][1];

    const msg1: WAMessage = {
      key: {
        id: 'wamid-fail-db',
        remoteJid: TARGET_GROUP_JID,
        fromMe: false,
        participant: '919876543210@s.whatsapp.net',
      },
      message: { conversation: 'First message causes DB error' },
    };

    const msg2: WAMessage = {
      key: {
        id: 'wamid-success-db',
        remoteJid: TARGET_GROUP_JID,
        fromMe: false,
        participant: '919876543210@s.whatsapp.net',
      },
      message: { conversation: 'Second message succeeds' },
    };

    await expect(handler({ messages: [msg1, msg2] })).resolves.not.toThrow();

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to store food announcement message in database',
      dbError,
      expect.objectContaining({ messageId: 'wamid-fail-db' })
    );

    expect(mockDb.insert).toHaveBeenCalledTimes(2);
  });

  it('works with default logger and default downloadMedia without throwing', async () => {
    const adapter = new FoodAnnouncementsInboundAdapter({
      targetGroupJid: TARGET_GROUP_JID,
      db: mockDb as any,
      connectionManager: mockConn as any,
    });

    adapter.start();
    const handler = mockConn.subscribe.mock.calls[0][1];

    await expect(
      handler({
        messages: [
          {
            key: { id: 'msg-default', remoteJid: TARGET_GROUP_JID, fromMe: false },
            participant: '919876543210@s.whatsapp.net',
            message: { conversation: 'Testing noop logger' },
          },
        ],
      })
    ).resolves.not.toThrow();

    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('prefers caption over fileName when document message provides both', async () => {
    const fakePdfBuffer = Buffer.from('%PDF-1.4');
    mockDownloadMedia.mockResolvedValue(fakePdfBuffer);

    const adapter = new FoodAnnouncementsInboundAdapter({
      targetGroupJid: TARGET_GROUP_JID,
      db: mockDb as any,
      connectionManager: mockConn as any,
      logger: mockLogger,
      downloadMedia: mockDownloadMedia as any,
    });

    adapter.start();
    const handler = mockConn.subscribe.mock.calls[0][1];

    await handler({
      messages: [
        {
          key: { id: 'msg-doc-both', remoteJid: TARGET_GROUP_JID, fromMe: false },
          participant: '919876543210@s.whatsapp.net',
          message: {
            documentMessage: {
              mimetype: 'application/pdf',
              caption: 'Document caption takes priority',
              fileName: 'some_filename.pdf',
            },
          },
        },
      ],
    });

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: 'document',
        textBody: 'Document caption takes priority',
      })
    );
  });

  it('ignores message when upsert payload or messages array is malformed', async () => {
    const adapter = new FoodAnnouncementsInboundAdapter({
      targetGroupJid: TARGET_GROUP_JID,
      db: mockDb as any,
      connectionManager: mockConn as any,
      logger: mockLogger,
    });

    adapter.start();
    const handler = mockConn.subscribe.mock.calls[0][1];

    await expect(handler(null)).resolves.not.toThrow();
    await expect(handler({})).resolves.not.toThrow();
    await expect(handler({ messages: 'not-an-array' })).resolves.not.toThrow();

    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});
