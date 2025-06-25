/**
 * This file contains the custom mapping rules between ChartHop and Active Directory / LDAP.
 *
 * You can configure this file and write your own transformers as appropriate for your organization.
 *
 * For a full list of AD/LDAP mappings, see http://www.kouti.com/tables/userattributes.htm
 *
 * Each FIELDS entry contains:
 *   label: Human-readable label for the field
 *   ldap: The field name on the AD/LDAP side
 *   charthop: The field name on the ChartHop side
 *   (Optional) charthopExtraFields: Additional field(s) to retrieve from ChartHop to support the transformation
 *   (Optional) transform: A function that, given the field value, and the ChartHop data object, returns the field
 *     value as it should be stored on the AD/LDAP side.
 */

function transformPhone(phone) {
  return phone.length === 12
    ? `${phone.slice(0, 2)}-${phone.slice(2, 5)}-${phone.slice(5, 8)}-${phone.slice(8)}`
    : phone;
}
module.exports.transformPhone = transformPhone;

module.exports.FIELDS = [
  { label: "Name", ldap: "displayName", charthop: "name" },
  {
    label: "First Name",
    ldap: "givenName",
    charthop: "name.first",
    charthopExtraFields: "name.pref",
    transform: function (value, job) {
      return job["name.pref"] ?? value;
    }
  },
  {
    label: "Last Name",
    ldap: "sn",
    charthop: "name.last"
  },
  {
    label: "Department",
    ldap: "department",
    charthop: "department.name"
  },
  {
    label: "Office Name",
    ldap: "physicalDeliveryOfficeName",
    charthop: "location.name"
  },
  {
    label: "Street",
    ldap: "streetAddress",
    charthop: "location.address.street1"
  },
  { label: "City", ldap: "l", charthop: "location.address.city" },
  { label: "State", ldap: "st", charthop: "location.address.state" },
  { label: "Country", ldap: "co", charthop: "location.address.country" },
  {
    label: "Postal Code",
    ldap: "postalCode",
    charthop: "location.address.postal"
  },
  { label: "Title", ldap: "title", charthop: "title" },
  {
    label: "Work Phone",
    ldap: "telephoneNumber",
    charthop: "contact.workPhone",
    transform: transformPhone
  },
  { label: "Work Email", ldap: "mail", charthop: "contact.workEmail" },
  { label: "Manager", ldap: "manager", charthop: "manager" }
];
