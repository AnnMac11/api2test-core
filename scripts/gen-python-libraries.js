/*
 * Generates the Python curated libraries from the canonical C# set, translating each method body
 * to Python (Faker + requests) while preserving id / methodName / parameters / returnType /
 * category / application so Data Dictionary auto-matching stays identical across languages.
 *
 * Run from the core repo:  node scripts/gen-python-libraries.js
 * Output: src/data/libraries/python/{data-library,api-method-library}.json
 *
 * The DataGenerator the PythonEmitter assembles provides: self._fake (faker.Faker),
 * self._rng (random.Random), and `import string, json, uuid` + `from datetime import datetime, timedelta`.
 * The ApiMethods module provides `import os, requests, urllib.parse, re`.
 */
const fs = require('path').join ? require('fs') : require('fs');
const path = require('path');

const CSHARP = path.join(__dirname, '..', 'src', 'data', 'libraries', 'csharp');
const PY = path.join(__dirname, '..', 'src', 'data', 'libraries', 'python');

// methodName -> Python source (a full def, column 0; body indented 4 spaces).
const DATA = {
  FirstName: `def first_name(self) -> str:\n    return self._fake.first_name()`,
  LastName: `def last_name(self) -> str:\n    return self._fake.last_name()`,
  DateOfBirth: `def date_of_birth(self, min_age: int = 18, max_age: int = 80) -> datetime:\n    return datetime.now() - timedelta(days=365 * self.random_age(min_age, max_age))`,
  Email: `def email(self, first_name: str = None) -> str:\n    return self._fake.email()`,
  PhoneNumber: `def phone_number(self) -> str:\n    return "+1" + self._fake.numerify("##########")`,
  CreditCardNumber: `def credit_card_number(self) -> str:\n    return self._fake.credit_card_number()`,
  HireDate: `def hire_date(self) -> datetime:\n    return self._fake.date_time_between(start_date="-10y")`,
  ProductId: `def product_id(self) -> str:\n    return f"PRD-{self._rng.randint(10000, 99999)}"`,
  RandomStr: `def random_str(self, length: int = 8) -> str:\n    return "".join(self._rng.choices(string.ascii_letters + string.digits, k=length))`,
  UserName: `def user_name(self, length: int = 8) -> str:\n    return self.random_str(length)`,
  Password: `def password(self, length: int = 12, include_special_chars: bool = True) -> str:\n    return self._fake.password(length=length, special_chars=include_special_chars)`,
  RandomAge: `def random_age(self, min_age: int = 18, max_age: int = 99) -> int:\n    return self._rng.randint(min_age, max_age)`,
  GetDate: `def get_date(self, days_offset: int = 0) -> datetime:\n    return datetime.now() + timedelta(days=days_offset)`,
  GetDateStr: `def get_date_str(self, days_offset: int = 0, fmt: str = "%Y-%m-%d") -> str:\n    return (datetime.now() + timedelta(days=days_offset)).strftime(fmt)`,
  GetDateTimeStr: `def get_date_time_str(self, days_offset: int = 0, fmt: str = "%Y-%m-%dT%H:%M:%SZ") -> str:\n    return (datetime.now() + timedelta(days=days_offset)).strftime(fmt)`,
  BooleanTrue: `def boolean_true(self) -> bool:\n    return True`,
  BooleanFalse: `def boolean_false(self) -> bool:\n    return False`,
  ProfilePictureUrl: `def profile_picture_url(self, width: int = 200, height: int = 200) -> str:\n    return f"https://picsum.photos/{width}/{height}"`,
  Bio: `def bio(self, max_length: int = 160) -> str:\n    return self._fake.sentence(nb_words=15)[:max_length]`,
  LocationObject: `def location_object(self) -> str:\n    return json.dumps({"city": self._fake.city(), "state": self._fake.state(), "country": self._fake.country()})`,
  UserPreferencesObject: `def user_preferences_object(self) -> str:\n    return json.dumps({\n        "theme": self._rng.choice(["light", "dark"]),\n        "language": self._rng.choice(["en", "es", "fr", "de"]),\n        "notifications": self._rng.random() < 0.5,\n    })`,
  DateOfBirthStr: `def date_of_birth_str(self, min_age: int = 18, max_age: int = 80, fmt: str = "%Y-%m-%d") -> str:\n    return (datetime.now() - timedelta(days=365 * self.random_age(min_age, max_age))).strftime(fmt)`,
  IpAddress: `def ip_address(self) -> str:\n    return self._fake.ipv4()`,
  CompanyName: `def company_name(self) -> str:\n    return self._fake.company()`,
  JobTitle: `def job_title(self) -> str:\n    return self._fake.job()`,
  FullName: `def full_name(self) -> str:\n    return self._fake.name()`,
  CurrencyCode: `def currency_code(self) -> str:\n    return self._rng.choice(["usd", "eur", "gbp", "cad", "aud"])`,
  PaymentAmount: `def payment_amount(self, min_value: int = 100, max_value: int = 100000) -> int:\n    return self._rng.randint(min_value, max_value)`,
  StripeCustomerId: `def stripe_customer_id(self) -> str:\n    return "cus_" + "".join(self._rng.choices(string.ascii_letters + string.digits, k=14))`,
  StripeProductId: `def stripe_product_id(self) -> str:\n    return "prod_" + "".join(self._rng.choices(string.ascii_letters + string.digits, k=14))`,
  StripePriceId: `def stripe_price_id(self) -> str:\n    return "price_" + "".join(self._rng.choices(string.ascii_letters + string.digits, k=14))`,
  SubscriptionInterval: `def subscription_interval(self) -> str:\n    return self._rng.choice(["day", "week", "month", "year"])`,
  PriceFormatted: `def price_formatted(self, min_value: int = 10, max_value: int = 1000) -> str:\n    return f"\${self._rng.randint(min_value, max_value)}.{self._rng.randint(0, 99):02d}"`,
  ProductName: `def product_name(self) -> str:\n    return f"{self._fake.word().capitalize()} {self._fake.word()}"`,
  ProductDescription: `def product_description(self) -> str:\n    return self._fake.sentence()`,
  TaxRate: `def tax_rate(self, min_value: float = 0.05, max_value: float = 0.15) -> float:\n    return round(self._rng.uniform(min_value, max_value), 2)`,
  TweetText: `def tweet_text(self, max_length: int = 280) -> str:\n    return self._fake.sentence(nb_words=self._rng.randint(5, 20))[:max_length]`,
  TwitterUsername: `def twitter_username(self) -> str:\n    return "@" + self._fake.user_name().lower()`,
  TwitterUserId: `def twitter_user_id(self) -> str:\n    return str(self._rng.randint(1000000000, 9999999999))`,
  Hashtag: `def hashtag(self) -> str:\n    return "#" + self._fake.word().replace(" ", "")`,
  TweetWithHashtags: `def tweet_with_hashtags(self, hashtag_count: int = 2) -> str:\n    tags = " ".join(self.hashtag() for _ in range(hashtag_count))\n    return f"{self.tweet_text(240)} {tags}"`,
  SocialBio: `def social_bio(self, max_length: int = 160) -> str:\n    return self._fake.paragraph()[:max_length]`,
  FollowerCount: `def follower_count(self, min_value: int = 0, max_value: int = 100000) -> int:\n    return self._rng.randint(min_value, max_value)`,
  EngagementCount: `def engagement_count(self, min_value: int = 0, max_value: int = 10000) -> int:\n    return self._rng.randint(min_value, max_value)`,
  RandomBoolean: `def random_boolean(self) -> bool:\n    return self._rng.random() < 0.5`,
  ActiveStatus: `def active_status(self, true_percentage: float = 0.8) -> bool:\n    return self._rng.random() < true_percentage`,
  UuidString: `def uuid_string(self) -> str:\n    return str(uuid.uuid4())`,
  CurrencySymbol: `def currency_symbol(self) -> str:\n    return self._rng.choice(["$", "€", "£", "¥", "₹"])`,
  RandomDecimal: `def random_decimal(self, min_value: float = 0.01, max_value: float = 1000, decimals: int = 2) -> float:\n    return round(self._rng.uniform(min_value, max_value), decimals)`,
  Percentage: `def percentage(self, min_value: int = 0, max_value: int = 100) -> int:\n    return self._rng.randint(min_value, max_value)`,
  WebsiteUrl: `def website_url(self) -> str:\n    return self._fake.url()`,
  ApiKey: `def api_key(self, length: int = 32) -> str:\n    return "sk_test_" + "".join(self._rng.choices(string.ascii_letters + string.digits, k=length))`,
  Address: `def address(self) -> str:\n    return self._fake.street_address()`,
  City: `def city(self) -> str:\n    return self._fake.city()`,
  State: `def state(self) -> str:\n    return self._fake.state()`,
  ZipCode: `def zip_code(self) -> str:\n    return self._fake.postcode()`,
  Country: `def country(self) -> str:\n    return self._fake.country()`,
  CountryCode: `def country_code(self) -> str:\n    return self._fake.country_code()`,
  twilioToken: `def twilio_token(self) -> str:\n    return "1233f8382577d0abc6e97116c017fb33"`,
  twilioSID: `def twilio_sid(self) -> str:\n    return "AC7503d23afe53510c91994802ceff2c52"`,
  RandomId: `def random_id(self, min_value: int = 1, max_value: int = 100000) -> int:\n    return self._rng.randint(min_value, max_value)`,
  OrderStatus: `def order_status(self) -> str:\n    return self._rng.choice(["placed", "approved", "delivered"])`,
  PetStatus: `def pet_status(self) -> str:\n    return self._rng.choice(["available", "pending", "sold"])`,
  Quantity: `def quantity(self, min_value: int = 1, max_value: int = 10) -> int:\n    return self._rng.randint(min_value, max_value)`,
  BusinessName: `def business_name(self) -> str:\n    return self._fake.company()`,
  AddressLine1: `def address_line1(self) -> str:\n    return self._fake.street_address()`,
  AddressLine2: `def address_line2(self) -> str:\n    return self._fake.secondary_address()`,
  PostalCode: `def postal_code(self) -> str:\n    return self._fake.postcode()`,
  AccountBalance: `def account_balance(self, min_value: int = -100000, max_value: int = 100000) -> int:\n    return self._rng.randint(min_value, max_value)`,
  CouponCode: `def coupon_code(self) -> str:\n    return "".join(self._rng.choices(string.ascii_letters + string.digits, k=8)).upper()`,
  MetadataObject: `def metadata_object(self) -> str:\n    return json.dumps({"source": "".join(self._rng.choices(string.ascii_letters + string.digits, k=6))})`,
  PaymentMethodId: `def payment_method_id(self) -> str:\n    return "pm_" + "".join(self._rng.choices(string.ascii_letters + string.digits, k=24))`,
  PaymentSourceId: `def payment_source_id(self) -> str:\n    return "src_" + "".join(self._rng.choices(string.ascii_letters + string.digits, k=24))`,
  Locale: `def locale(self) -> str:\n    return self._rng.choice(["en-US", "en-GB", "fr-FR", "de-DE", "es-ES"])`,
  TaxExemptStatus: `def tax_exempt_status(self) -> str:\n    return self._rng.choice(["none", "exempt", "reverse"])`,
  TaxId: `def tax_id(self) -> str:\n    return self._fake.country_code() + self._fake.numerify("#########")`,
  InvoicePrefix: `def invoice_prefix(self) -> str:\n    return "".join(self._rng.choices(string.ascii_letters + string.digits, k=3)).upper()`,
  MiddleName: `def middle_name(self) -> str:\n    return self._fake.first_name()`,
  Iban: `def iban(self) -> str:\n    return self._fake.iban()`,
  Latitude: `def latitude(self) -> float:\n    return float(self._fake.latitude())`,
  Longitude: `def longitude(self) -> float:\n    return float(self._fake.longitude())`,
  StripeBaseUrl: `def stripe_base_url(self) -> str:\n    return "https://api.stripe.com"`,
  PetStoreBaseUrl: `def pet_store_base_url(self) -> str:\n    return "https://petstore.swagger.io/v2"`,
  StripeAddress: `def stripe_address(self, country: str = "US") -> dict:\n    return {\n        "line1": self._fake.street_address(),\n        "city": self._fake.city(),\n        "state": self._fake.state_abbr(),\n        "postal_code": self._fake.postcode(),\n        "country": country,\n    }`,
  StringList: `def string_list(self, *values: str) -> list:\n    return list(values)`,
  StripeTaxIds: `def stripe_tax_ids(self) -> list:\n    return [{"type": "eu_vat", "value": "DE123456789"}]`,
  TestCardNumber: `def test_card_number(self) -> str:\n    cards = ["4242424242424242", "4000056655665556", "5555555555554444", "6011111111111117", "378282246310005"]\n    return self._rng.choice(cards)`,
  StripeTestPaymentMethod: `def stripe_test_payment_method(self) -> str:\n    return "pm_card_visa"`,
  StripeDeclinedCard: `def stripe_declined_card(self) -> str:\n    return "4000000000000002"`,
  StripeDeclinedPaymentMethod: `def stripe_declined_payment_method(self) -> str:\n    return "pm_card_chargeDeclined"`,
  CouponDuration: `def coupon_duration(self) -> str:\n    return "once"`,
  StripeCurrency: `def stripe_currency(self) -> str:\n    return "usd"`,
  AmountInCents: `def amount_in_cents(self) -> int:\n    return self._rng.randint(500, 50000)`,
};

// methodName -> Python source for ApiMethods (module-level functions using requests).
const WRAP = {
  GetAsync: `def get_async(token, url):\n    resp = requests.get(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})\n    resp.raise_for_status()\n    return resp.json()`,
  PutJsonAsync: `def put_json_async(token, url, json_body):\n    return requests.put(url, headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "application/json"}, data=json_body)`,
  DeleteAsync: `def delete_async(token, url):\n    return requests.delete(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})`,
  ExtractTokenFromResponse: `def extract_token_from_response(response):\n    if response.ok:\n        data = response.json()\n        return data.get("token") or data.get("access_token") or ""\n    return ""`,
  ValidateResponseAsync: `def validate_response_async(response):\n    code = response.status_code\n    passed = code in (200, 201)\n    print(f"PASS: status {code}" if passed else f"FAIL: expected 200 or 201 but got {code}")\n    return passed`,
  ParseJsonResponse: `def parse_json_response(response):\n    response.raise_for_status()\n    return response.json()`,
  GetStripeToken: `def get_stripe_token():\n    key = os.environ.get("STRIPE_TEST_KEY")\n    if not key:\n        raise RuntimeError("Set the STRIPE_TEST_KEY environment variable to your Stripe test secret key.")\n    return key`,
  PostFormAsync: `def post_form_async(token, url, form_body):\n    return requests.post(url, headers={"Authorization": f"Bearer {token}", "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"}, data=form_body)`,
  PostJsonAsync: `def post_json_async(token, url, json_body):\n    return requests.post(url, headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "application/json"}, data=json_body)`,
  FormUrlEncode: `def form_url_encode(data):\n    return urllib.parse.urlencode(data)`,
  ExtractFieldFromResponse: `def extract_field_from_response(response, field_path):\n    data = response.json()\n    for part in field_path.split("."):\n        if isinstance(data, dict):\n            data = data.get(part)\n        else:\n            return ""\n    return "" if data is None else str(data)`,
  StripeBaseUrl: `def stripe_base_url():\n    return "https://api.stripe.com"`,
  ApiBaseUrl: `def api_base_url():\n    return "https://api.example.com"`,
  DeleteByParamAsync: `def delete_by_param_async(token, url_template, value):\n    url = re.sub(r"\\{[^}]+\\}", urllib.parse.quote(value, safe=""), url_template, count=1)\n    return requests.delete(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})`,
  ValidateDeleteResponseAsync: `def validate_delete_response_async(response):\n    code = response.status_code\n    passed = code in (200, 204)\n    print(f"PASS (delete): status {code}" if passed else f"FAIL (delete): expected 200 or 204 but got {code}")\n    return passed`,
  PostMultipartAsync: `def post_multipart_async(token, url, file_path, file_field_name):\n    with open(file_path, "rb") as fh:\n        files = {file_field_name: (os.path.basename(file_path), fh)}\n        return requests.post(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"}, files=files)`,
  PetStoreBaseUrl: `def pet_store_base_url():\n    return "https://petstore.swagger.io/v2"`,
  GetPetStoreToken: `def get_pet_store_token():\n    return os.environ.get("PETSTORE_API_KEY") or "special-key"`,
};

function translate(file, map, label) {
  const src = JSON.parse(fs.readFileSync(path.join(CSHARP, file), 'utf8'));
  const missing = src.filter((m) => !(m.methodName in map)).map((m) => m.methodName);
  if (missing.length) {
    throw new Error(`${label}: no Python translation for: ${missing.join(', ')}`);
  }
  const out = src.map((m) => ({ ...m, code: map[m.methodName] }));
  fs.writeFileSync(path.join(PY, file), JSON.stringify(out, null, 2) + '\n');
  console.log(`${label}: wrote ${out.length} -> python/${file}`);
}

translate('data-library.json', DATA, 'Data Library');
translate('api-method-library.json', WRAP, 'API Method Library');
