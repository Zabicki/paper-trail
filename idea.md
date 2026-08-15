# Project Brief: Expense Tracking and Visualization App

A personal finance application designed to allow users to easily upload, manually enter, track, and visualize their daily expenses and incomes.
The app focuses on a frictionless user experience for data entry and provides clear, customizable insights into spending habits.

Currently users use a heave google sheet that is hard to maintain, use and develop.
The main hardships are: difficulty in understanding queries, lots of sheets, inconvenient way of inputting expenses/incomes, poor visualizations.

## 3. Core Features
* **Manual Expense Entry:** Functionality to input individual expenses manually.
* **Streamlined Daily Input:** A frictionless data entry flow contextualized by the current day, minimizing the number of clicks and screens required to log routine expenses.
* **Custom Categories:** Ability for users to define and manage their own expense categories.
* **Smart Filtering:** A feature to filter out large, recurring costs (e.g., rent, car payments) that might skew or obscure day-to-day spending patterns.
* **Date-Based Visualization:** Tools to visualize costs over specific timeframes, including:
    * Custom date range selection.
    * Default quick-select ranges (e.g., Last Week, Last Month, Year-to-Date).
* **Category-Based Visualization:** Charts and graphs displaying spending distribution across user-defined categories.
* **AI Receipt Parsing & Auto-Categorization:** Integration with external AI models (via API calls). The user will upload a receipt, and the model will parse the data and automatically assign items to the user's custom categories (categories will be passed to the model via a system prompt).
* **AI Financial Analysis & Insights:** An intelligent diagnostic feature where an AI model summarizes spending patterns. It will analyze data to:
  * Identify categories where spending is too high.
  * Highlight week-over-week or month-over-month increases and decreases.
  * Detect potentially unnecessary expenses.
  * Proactively notify and advise the user based on these findings.


## 4. Future Enhancements (Post-MVP)
* **Data Import:** Support for bulk importing historical financial data via Excel (.xlsx/.csv) files.
