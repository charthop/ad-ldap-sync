var ldap = require("ldapjs");
var needle = require("needle");

var FIELDS = require("./fields.js").FIELDS;
var CHARTHOP_ORG_ID = process.env.CHARTHOP_ORG_ID;
var CHARTHOP_TOKEN = process.env.CHARTHOP_TOKEN;
var CHARTHOP_TOKEN_SINGLE = CHARTHOP_TOKEN ? CHARTHOP_TOKEN.split(",")[0] : "";

var LDAP_URL = process.env.LDAP_URL;
var LDAP_USER = process.env.LDAP_USER;
var LDAP_PASS = process.env.LDAP_PASS;
var LDAP_SEARCH = process.env.LDAP_SEARCH;

var SYNC_ALLOWLIST = process.env.SYNC_ALLOWLIST ? process.env.SYNC_ALLOWLIST.split(",") : [];
var SYNC_TESTMATCH = process.env.SYNC_TESTMATCH;

/** Fetch all currently-filled ChartHop jobs from the org roster **/
async function fetchCharthopJobs(orgId, token) {
  let fields = FIELDS.map(f => `${f.charthop}${f.charthopExtraFields ? `,${f.charthopExtraFields}` : ""}`).join(",");
  fields = `jobId,${fields}`;
  return needle(
    "GET",
    `https://api.charthop.com/v2/org/${orgId}/job?limit=10000&format=minimal&q=open:filled&fields=${fields}`,
    { headers: { authorization: `Bearer ${token}` } }
  ).then(resp => {
    return resp.body.data.map(r => ({ id: r.jobId, ...r }));
  });
}

/** Send a notification email via ChartHop **/
async function notifyCharthop(emailSubject, emailContentHtml) {
  return needle(
    "POST",
    "https://api.charthop.com/v1/app/notify",
    { emailSubject, emailContentHtml },
    { json: true, headers: { authorization: `Bearer ${CHARTHOP_TOKEN_SINGLE}` } }
  );
}

/** Connect to the LDAP server **/
async function connectLdap() {
  console.log(`Connecting to LDAP server at ${LDAP_URL}`);

  var client = ldap.createClient({
    url: LDAP_URL
  });
  await new Promise((resolve, reject) => {
    client.bind(LDAP_USER, LDAP_PASS, function (err, res) {
      if (err) {
        reject(err);
      } else {
        resolve(res);
      }
    });
  });

  return client;
}

/** Fetch the LDAP jobs **/
async function fetchLdapJobs(ldapClient) {
  let sizeLimit = Number.parseInt(process.env.LDAP_PAGED_LIMIT ?? 100);

  var opts = {
    filter: "(&(objectCategory=person)(objectClass=user))",
    scope: "sub",
    attributes: ["dn", "sn", "cn", ...FIELDS.map(f => f.ldap)],
    sizeLimit: sizeLimit,
    paged: sizeLimit ? true : false
  };
  return new Promise((resolve, reject) => {
    ldapClient.search(LDAP_SEARCH, opts, function (error, res) {
      if (error) {
        reject(error);
      }

      var results = [];

      res.on("searchEntry", function (entry) {
        results.push(entry.object);
      });

      res.on("error", function (err) {
        reject(err);
      });

      res.on("end", function () {
        resolve(results);
      });
    });
  });
}

/** Given an LDAP job and a ChartHop job, compare the two and sync any differences **/
async function syncJob(ldapClient, charthopJob, adJob, adJobs) {
  // assign the charthop manager property, based on finding the DN in the adJobs map
  charthopJob.manager = adJobs[charthopJob.manager] ? adJobs[charthopJob.manager].dn : "";

  var syncedFields = [];
  let changes = [];
  let changeLog = [];
  for (let field of FIELDS) {
    if (!charthopJob[field.charthop]) {
      continue;
    }
    var transformedValue = charthopJob[field.charthop];
    if (field.transform) {
      transformedValue = field.transform(transformedValue, charthopJob);
    }

    if (transformedValue !== adJob[field.ldap]) {
      var modification = {};
      modification[field.ldap] = transformedValue;

      var change = new ldap.Change({
        operation: "replace",
        modification
      });
      changes.push(change);

      changeLog.push(`${adJob.cn}/${field.ldap}: ${adJob[field.ldap]} => ${transformedValue}`);
      syncedFields.push(field.label);
    }
  }

  if (SYNC_ALLOWLIST.length === 0 || SYNC_ALLOWLIST.includes(adJob.cn)) {
    await new Promise((resolve, reject) => {
      ldapClient.modify(adJob.dn, changes, function (err, res) {
        if (err) {
          reject(err);
        } else {
          resolve(res);
        }
      });
    });

    for (const log of changeLog) console.log(`Updated: ${log}`);
  } else {
    for (const log of changeLog) console.log(`Skipping, not on allowlist: ${log}`);
  }
  return syncedFields;
}

/** Given a ChartHop job and an LDAP job, determine whether they match or not **/
function doesCharthopJobMatch(charthopJob, adJob) {
  if (
    adJob.mail &&
    charthopJob["contact.workEmail"] &&
    adJob.mail.toLowerCase().split("@")[0] === charthopJob["contact.workEmail"].split("@")[0]
  ) {
    return true;
  }
  return false;
}

/** Build a map of ChartHop ID to ChartHop job **/
function mapCharthop(charthopJobs) {
  var map = {};
  for (let job of charthopJobs) {
    map[job.id] = job;
  }
  return map;
}

/** Build a map of ChartHop ID to AD job, based on matching work email **/
function mapCharthopToAd(charthopJobs, adJobs) {
  var map = {};
  for (let chJob of charthopJobs) {
    for (let adJob of adJobs) {
      if (doesCharthopJobMatch(chJob, adJob)) {
        map[chJob.id] = adJob;
      }
    }
  }
  return map;
}

exports.doesCharthopJobMatch = doesCharthopJobMatch;

exports.handler = async () => {
  var ldapClient;
  try {
    ldapClient = await connectLdap();

    var charthopJobs = [];
    for (var i = 0; i < CHARTHOP_ORG_ID.split(",").length; i++) {
      const orgId = CHARTHOP_ORG_ID.split(",")[i];
      const token = CHARTHOP_TOKEN.split(",")[i];
      var fetchJobs = await fetchCharthopJobs(orgId, token);
      charthopJobs = [...charthopJobs, ...fetchJobs];
      console.log(`Fetched ${fetchJobs.length} jobs from ChartHop org ${orgId}`);
    }
    console.log(`Fetched ${charthopJobs.length} jobs from ChartHop`);

    var adJobs = await fetchLdapJobs(ldapClient);
    console.log(`Fetched ${adJobs.length} jobs from AD LDAP`);

    var chMap = mapCharthop(charthopJobs);
    var adMap = mapCharthopToAd(charthopJobs, adJobs);

    console.log(`Matched ${Object.keys(adMap).length}`);

    // in SYNC_TESTMATCH mode, always match the AD job matching the SYNC_TESTMATCH with a random ChartHop job
    if (SYNC_TESTMATCH) {
      var testJob = charthopJobs[Math.floor(Math.random() * charthopJobs.length)];
      console.log(`Set test job to ${testJob.title} ${testJob.id}`);
      var testAdJobs = adJobs.filter(j => j.cn === SYNC_TESTMATCH);
      if (testAdJobs.length > 0) {
        adMap[testJob.id] = testAdJobs[0];
      }
    }

    var updated = [];
    for (let chId in adMap) {
      var chJob = chMap[chId];
      var adJob = adMap[chId];
      if (chJob && adJob) {
        try {
          var synced = await syncJob(ldapClient, chJob, adJob, adMap);
          if (synced.length > 0) {
            updated.push({ adJob, chJob, synced });
          }
        } catch (error) {
          console.error(`Error attempting to update ${adJob.cn}\nError: ${JSON.stringify(error)}`);
        }
      }
    }

    if (updated.length > 0) {
      var syncHtml = "<p>Updated the following Active Directory entries:</p>";
      for (let upd of updated) {
        syncHtml += `<div><b>${upd.adJob.cn}</b>: ${upd.synced.join(", ")}</div>`;
      }
      await notifyCharthop(`Synced ${updated.length} entries`, syncHtml);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        charthopJobs: charthopJobs.length,
        adJobs: adJobs.length,
        updated: updated.length
      })
    };
  } catch (error) {
    await notifyCharthop(
      "Error completing sync",
      `<p>There was an unexpected error:</p><br/><div><code>${JSON.stringify(error)}</code></div>\n` +
        `<br/><p>Stack trace:</p><pre>${error.stack}</pre>`
    );

    return {
      statusCode: 500,
      body: JSON.stringify({ error })
    };
  } finally {
    await new Promise(resolve => {
      console.log("Disconnecting from LDAP server");
      ldapClient.unbind(resolve);
      ldapClient.destroy();
    });
  }
};
