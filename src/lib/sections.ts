export type SectionSlug =
  | "members"
  | "money-owed"
  | "live-dashboard"
  | "pt-bookings"
  | "class-bookings"
  | "subscriptions"
  | "transactions"
  | "sales"
  | "pt-sessions"
  | "classes"
  | "membership-plans";

export type ColumnDef = { key: string; label: string };

export type SectionConfig = {
  slug: SectionSlug;
  title: string;
  description: string;
  columns: ColumnDef[];
  actionHref?: string;
  actionLabel?: string;
};

export const SECTIONS: SectionConfig[] = [
  {
    slug: "members",
    title: "Members",
    description: "Member directory",
    columns: [
      { key: "first_name", label: "First name" },
      { key: "last_name", label: "Last name" },
      { key: "email", label: "Email" },
      { key: "role", label: "Role" },
      { key: "join_date", label: "Join date" },
      { key: "exp_next_payment_date", label: "Renewal date" },
      { key: "member_id", label: "Member ID" },
    ],
  },
  {
    slug: "money-owed",
    title: "Money Owed",
    description: "Outstanding balances",
    columns: [
      { key: "member_name", label: "Member" },
      { key: "member_id", label: "Member ID" },
      { key: "product_id", label: "Product ID" },
      { key: "amount_owed", label: "Amount owed" },
      { key: "days_remaining", label: "Days remaining" },
      { key: "health_check", label: "Health check" },
    ],
  },
  {
    slug: "live-dashboard",
    title: "Live Dashboard",
    description: "Member status and expiry",
    columns: [
      { key: "member_id", label: "Member ID" },
      { key: "status", label: "Status" },
      { key: "expiry_date", label: "Expiry date" },
      { key: "days_remaining", label: "Days remaining" },
    ],
  },
  {
    slug: "pt-bookings",
    title: "PT Bookings",
    description: "Personal training bookings",
    actionHref: "/pt-bookings/generate-recurring",
    actionLabel: "Generate Recurring PT Session Booking",
    columns: [
      { key: "pt_booking_id", label: "Booking ID" },
      { key: "member_id", label: "Member ID" },
      { key: "product_id", label: "Product ID" },
      { key: "booking_date", label: "Date" },
      { key: "payment_status", label: "Payment" },
      { key: "checked_in", label: "Checked in" },
      { key: "price", label: "Price" },
      { key: "quantity", label: "Qty" },
    ],
  },
  {
    slug: "class-bookings",
    title: "Class Bookings",
    description: "Class bookings",
    columns: [
      { key: "class_booking_id", label: "Booking ID" },
      { key: "member_id", label: "Member ID" },
      { key: "product_id", label: "Product ID" },
      { key: "booking_date", label: "Date" },
      { key: "payment_status", label: "Payment" },
      { key: "checked_in", label: "Checked in" },
      { key: "price", label: "Price" },
      { key: "quantity", label: "Qty" },
    ],
  },
  {
    slug: "subscriptions",
    title: "Subscriptions",
    description: "Active subscriptions",
    columns: [
      { key: "subscription_id", label: "Subscription ID" },
      { key: "member_id", label: "Member ID" },
      { key: "product_id", label: "Product ID" },
      { key: "status", label: "Status" },
      { key: "start_date", label: "Start date" },
      { key: "expiry_date", label: "Expiry date" },
      { key: "days_remaining", label: "Days remaining" },
      { key: "price", label: "Price" },
    ],
  },
  {
    slug: "transactions",
    title: "Transactions",
    description: "Purchase history and refunds",
    columns: [
      { key: "sales_id", label: "Sales ID" },
      { key: "date_time", label: "Date / time" },
      { key: "member_id", label: "Member ID" },
      { key: "email", label: "Email" },
      { key: "status", label: "Status" },
      { key: "grand_total", label: "Grand total" },
    ],
  },
  {
    slug: "sales",
    title: "Sales",
    description: "Transactions by category",
    columns: [
      { key: "category", label: "Category" },
      { key: "count", label: "Count" },
      { key: "revenue", label: "Revenue" },
    ],
  },
  {
    slug: "pt-sessions",
    title: "PT Sessions",
    description: "Personal training sessions",
    columns: [
      { key: "product_id", label: "Product ID" },
      { key: "session_name", label: "Session" },
      { key: "session_duration", label: "Duration" },
      { key: "date_time", label: "Date / time" },
      { key: "price", label: "Price" },
      { key: "trainer", label: "Trainer" },
      { key: "category", label: "Category" },
    ],
  },
  {
    slug: "classes",
    title: "Classes",
    description: "Class schedule",
    columns: [
      { key: "product_id", label: "Product ID" },
      { key: "class_name", label: "Class" },
      { key: "instructor", label: "Instructor" },
      { key: "date", label: "Date" },
      { key: "time", label: "Time" },
      { key: "capacity", label: "Capacity" },
      { key: "status", label: "Status" },
      { key: "price", label: "Price" },
    ],
  },
  {
    slug: "membership-plans",
    title: "Membership Plans",
    description: "Plans and pricing",
    columns: [
      { key: "product_id", label: "Product ID" },
      { key: "plan_name", label: "Plan" },
      { key: "price", label: "Price" },
      { key: "length", label: "Length" },
      { key: "unit", label: "Unit" },
      { key: "access_level", label: "Access" },
      { key: "category", label: "Category" },
    ],
  },
];

export function getSection(slug: SectionSlug): SectionConfig | undefined {
  return SECTIONS.find((s) => s.slug === slug);
}
