let ldap = require("ldapjs");
let request = require("request");
let when = require("jest-when");

jest.mock("request");
jest.mock("./fields", () => ({
  FIELDS: [
    { label: "Name", ldap: "displayName", charthop: "name" },
    { label: "Work Email", ldap: "mail", charthop: "contact.workEmail" }
  ]
}));

let ldapServer = ldap.createServer();

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

  ldapServer.bind("cn=user", (req, res, next) => {
    res.end();
    return next();
  });
});

afterAll(() => {
  ldapServer.removeAllListeners();
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
  request.mockImplementation((options, callback) => {
    throw options;
  });

  when
    .when(request)
    .calledWith(
      `https://api.charthop.com/v2/org/test/job?limit=10000&format=minimal&q=open:filled&fields=jobId,name,contact.workEmail`,
      expect.anything(),
      expect.anything()
    )
    .mockImplementation((u, o, callback) =>
      callback(
        null,
        null,
        JSON.stringify({
          data: [{ jobId: 0, name: "Brian Hartvigsen", "contact.workEmail": "brian.hartvigsen@charthop.com" }]
        })
      )
    );

  when
    .when(request)
    .calledWith(expect.anything(), expect.anything())
    .mockImplementation((request, callback) => {
      if (request && request.url === "https://api.charthop.com/v1/app/notify") {
        if (request && request.json && request.json.subject === "Error completing sync") {
          throw request;
        }
        callback(null, null, null);
      } else {
        throw request;
      }
    });

  ldapServer.search(process.env.LDAP_SEARCH, (req, res, next) => {
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
  });

  ldapServer.modify("", (req, res, next) => {
    res.end();
    return next();
  });

  let sync = require("./index");
  await sync.handler();
  when.verifyAllWhenMocksCalled();
});
