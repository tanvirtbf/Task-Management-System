import type { Customer } from "../types";
import { fakeId } from "../lib/fake-id";

/**
 * Lightweight customer registry — keyed by phone number (the de-facto
 * customer ID in Bangladesh ecom). Built from the same seeded data that
 * populates the orders / complaints mocks so that drilling into a phone
 * number from any task surfaces the full history.
 */

const seedCustomers: Customer[] = [
    {
        id: fakeId(),
        phone: "01712345678",
        name: "Rahim Uddin",
        defaultAddress: "Mirpur 10, Dhaka",
        totalOrders: 12,
        totalComplaints: 1,
        lifetimeValue: 28_400,
        vipFlag: true,
        createdAt: "2025-02-14T09:12:00Z",
        lastOrderAt: "2026-05-20T11:34:00Z",
    },
    {
        id: fakeId(),
        phone: "01819876543",
        name: "Salma Akter",
        defaultAddress: "Dhanmondi, Dhaka",
        totalOrders: 6,
        totalComplaints: 0,
        lifetimeValue: 11_200,
        vipFlag: true,
        createdAt: "2025-04-02T15:40:00Z",
        lastOrderAt: "2026-05-18T17:02:00Z",
    },
    {
        id: fakeId(),
        phone: "01911223344",
        name: "Karim Hossain",
        defaultAddress: "Chattogram",
        totalOrders: 2,
        totalComplaints: 1,
        lifetimeValue: 3_900,
        vipFlag: false,
        createdAt: "2026-01-10T10:00:00Z",
        lastOrderAt: "2026-05-12T13:21:00Z",
    },
    {
        id: fakeId(),
        phone: "01633445566",
        name: "Fatima Begum",
        defaultAddress: "Uttara Sector 7, Dhaka",
        totalOrders: 4,
        totalComplaints: 0,
        lifetimeValue: 7_650,
        vipFlag: false,
        createdAt: "2025-09-22T08:15:00Z",
        lastOrderAt: "2026-05-23T19:48:00Z",
    },
    {
        id: fakeId(),
        phone: "01512345678",
        name: "Tania Sultana",
        defaultAddress: "Bashundhara R/A, Dhaka",
        totalOrders: 9,
        totalComplaints: 2,
        lifetimeValue: 19_300,
        vipFlag: true,
        createdAt: "2025-06-30T14:00:00Z",
        lastOrderAt: "2026-05-26T10:11:00Z",
    },
];

export const customers: Customer[] = seedCustomers;

export const customersByPhone = new Map(
    customers.map((c) => [c.phone, c] as const),
);

export const findCustomerByPhone = (phone: string): Customer | undefined => {
    const digits = phone.replace(/\D/g, "").replace(/^88/, "");
    return customersByPhone.get(digits);
};
