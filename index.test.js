let ldap = require("ldapjs");
let needle = require("needle");
let when = require("jest-when");

jest.mock("needle");
jest.mock("./fields", () => ({
  FIELDS: [
    { label: "Name", ldap: "displayName", charthop: "name" },
    { label: "Work Email", ldap: "mail", charthop: "contact.workEmail" }
  ]
}));

let ldapServer = ldap.createServer();
let onSearch;
let onModify;
let onBind;

ldapServer.search("", (req, res, next) => {
  return onSearch(req, res, next);
});

ldapServer.modify("", (req, res, next) => {
  return onModify(req, res, next);
});

ldapServer.bind("", (req, res, next) => {
  return onBind(req, res, next);
});

beforeAll(async () => {
  await new Promise(resolve =>
    ldapServer.listen(0, "127.0.0.1", async () => {
      resolve();
    })
  );

  process.env.CHARTHOP_ORG_ID = "test";
  process.env.CHARTHOP_TOKEN = "token";
  process.env.LDAP_URL = ldapServer.url;
  process.env.LDAP_USER = "cn=user";
  process.env.LDAP_PASS = "pass";
  process.env.LDAP_SEARCH = "o=example";
  process.env.LDAP_PAGED_LIMIT = "0";

  onModify =
    onSearch =
    onBind =
      (req, res, next) => {
        res.end();
        return next();
      };
});

afterEach(() => {
  ldapServer.removeAllListeners();
});

afterAll(() => {
  ldapServer.close();
});

test("does charthop job match", () => {
  let doesCharthopJobMatch = require("./index").doesCharthopJobMatch;
  expect(
    doesCharthopJobMatch(
      {
        "contact.workEmail": "john.smith@example.com"
      },
      { mail: "john.SMITH@example-corp.com" }
    )
  ).toBeTruthy();
});

test("simple sync runs correctly", async () => {
  needle.mockImplementation((method, url) => {
    throw new Error(`Unhandled ${method} request to ${url}`);
  });

  when
    .when(needle)
    .calledWith(
      "GET",
      `https://api.charthop.com/v2/org/test/job`,
      { limit: 1000, format: "minimal", q: "open:filled", fields: "jobId,name,contact.workEmail", from: "" },
      expect.objectContaining({ headers: { authorization: `Bearer ${process.env.CHARTHOP_TOKEN}` } })
    )
    .mockResolvedValueOnce({
      statusCode: 200,
      body: {
        data: [{ jobId: 0, name: "Brian Hartvigsen", "contact.workEmail": "brian.hartvigsen@charthop.com" }]
      }
    });

  when
    .when(needle)
    .calledWith(
      "POST",
      "https://api.charthop.com/v1/app/notify",
      expect.anything(),
      expect.objectContaining({ headers: { authorization: `Bearer ${process.env.CHARTHOP_TOKEN}` } })
    )
    .mockImplementation((method, url, data) => {
      if (data?.emailSubject === "Error completing sync") {
        throw new Error(`Unhandled ${method} request to ${url}\n${JSON.stringify(data)}`);
      }
    });

  onSearch = (req, res, next) => {
    res.send({
      dn: req.dn.toString(),
      attributes: {
        objectclass: ["organization", "top"],
        displayName: "Berty McBertBert",
        mail: "brian.hartvigsen@charthop.com",
        cn: "brian.hartvigsen"
      }
    });
    res.end();
    return next();
  };

  onModify = (req, res, next) => {
    res.end();
    return next();
  };

  let sync = require("./index");
  await sync.handler();
  when.verifyAllWhenMocksCalled();
});

test("supports pagination", async () => {
  needle.mockImplementation((method, url) => {
    throw new Error(`Unhandled ${method} request to ${url}`);
  });

  when
    .when(needle)
    .calledWith(
      "GET",
      `https://api.charthop.com/v2/org/test/job`,
      { limit: 1000, format: "minimal", q: "open:filled", fields: "jobId,name,contact.workEmail", from: "" },
      expect.objectContaining({ headers: { authorization: `Bearer ${process.env.CHARTHOP_TOKEN}` } })
    )
    .mockResolvedValueOnce({
      statusCode: 200,
      body: {
        data: [{ jobId: 0, name: "Brian Hartvigsen", "contact.workEmail": "brian.hartvigsen@charthop.com" }],
        next: "2"
      }
    });

  when
    .when(needle)
    .calledWith(
      "GET",
      `https://api.charthop.com/v2/org/test/job`,
      { limit: 1000, format: "minimal", q: "open:filled", fields: "jobId,name,contact.workEmail", from: "2" },
      expect.objectContaining({ headers: { authorization: `Bearer ${process.env.CHARTHOP_TOKEN}` } })
    )
    .mockResolvedValueOnce({
      statusCode: 200,
      body: {
        data: [{ jobId: 0, name: "John Doe", "contact.workEmail": "john.doe@example.com" }]
      }
    });

  when
    .when(needle)
    .calledWith(
      "POST",
      "https://api.charthop.com/v1/app/notify",
      expect.anything(),
      expect.objectContaining({ headers: { authorization: `Bearer ${process.env.CHARTHOP_TOKEN}` } })
    )
    .mockImplementation((method, url, data) => {
      if (data?.emailSubject === "Error completing sync") {
        throw new Error(`Unhandled ${method} request to ${url}\n${JSON.stringify(data)}`);
      }
    });

  onSearch = (req, res, next) => {
    res.send({
      dn: req.dn.toString(),
      attributes: {
        objectclass: ["organization", "top"],
        displayName: "Berty McBertBert",
        mail: "brian.hartvigsen@charthop.com",
        cn: "brian.hartvigsen"
      }
    });
    res.end();
    return next();
  };

  onModify = (req, res, next) => {
    res.end();
    return next();
  };

  let sync = require("./index");
  await sync.handler();
  when.verifyAllWhenMocksCalled();
});
