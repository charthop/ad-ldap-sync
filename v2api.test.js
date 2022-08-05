const fetchCharthopJobs = require("./index").fetchCharthopJobs;
const fetchCharthopJobsV2 = require("./index").fetchCharthopJobsV2;

test("test jobs", async () => {
    var orgId ="add org"
    var token="add token"
    var fetchJobs = await fetchCharthopJobs(orgId, token);
    var fetchJobs2 = await fetchCharthopJobsV2(orgId, token);
    fetchJobs.sort((a,b) => (a.id > b.id) ? 1 : -1)
    fetchJobs2.sort((a,b) => (a.id > b.id) ? 1 : -1)
    expect(fetchJobs.length).toEqual(fetchJobs2.length)
    for(let x = 0; x < fetchJobs.length; x++) {
        expect(fetchJobs[x]).toEqual(fetchJobs2[x])
    }
});
