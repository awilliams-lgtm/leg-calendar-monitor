export const SA_GRAPHQL_URL = "https://api.stateaffairs.com/graphql";

export const PROFILE_QUERY = `query Profile {
  profile {
    user_id
    email
    name
    last_name
    is_active
    primary_state { state_abbr state_name }
  }
}`;

export const STATE_CONFIGS_QUERY = `query StateConfigs {
  stateConfigs {
    state_id
    state_info { state_abbr state_name }
  }
}`;

const LIST_FIELDS = `
    data {
      entity_id
      title
      event_date
      event_time
      location
      sa_url
      chamber
      state_id
    }
    total_count
`;

export const MEETINGS_SEARCH_V2_QUERY = `query MeetingsSearchV2($page: Int, $itemsPerPage: Int, $searchName: String, $state: Int, $startDate: String, $endDate: String, $includeHidden: Boolean, $useCreateTime: Boolean) {
  meetingsSearchV2(
    page: $page
    itemsPerPage: $itemsPerPage
    searchName: $searchName
    state: $state
    startDate: $startDate
    endDate: $endDate
    includeHidden: $includeHidden
    useCreateTime: $useCreateTime
  ) {
    totalMeetingCount
    data {
      meeting_id
      event_title
      event_date
      event_description
      event_location
      state_id
      state { state_id state_name state_abbr }
      is_cancelled
      is_hidden_from_customer
    }
  }
}`;

export const GET_MEETINGS_QUERY = `query GetMeetingsList($stateId: Int, $chamber: [String!], $itemsPerPage: Int, $eventDate: String, $query: String, $page: Int) {
  getMeetingsList(
    stateId: $stateId
    chamber: $chamber
    eventDate: $eventDate
    query: $query
    itemsPerPage: $itemsPerPage
    page: $page
  ) { ${LIST_FIELDS} }
}`;

export const GET_HEARINGS_QUERY = `query GetHearingsList($stateId: Int, $chamber: [String!], $itemsPerPage: Int, $eventDate: String, $query: String, $page: Int, $includeNeedsReviewBillHearings: Boolean = false, $onlyNeedsReviewBillHearings: Boolean = false) {
  getHearingsList(
    stateId: $stateId
    chamber: $chamber
    eventDate: $eventDate
    query: $query
    itemsPerPage: $itemsPerPage
    page: $page
    includeNeedsReviewBillHearings: $includeNeedsReviewBillHearings
    onlyNeedsReviewBillHearings: $onlyNeedsReviewBillHearings
  ) { ${LIST_FIELDS} }
}`;

export const SA_CLIENT_QUERIES = {
  url: SA_GRAPHQL_URL,
  profile: PROFILE_QUERY,
  stateConfigs: STATE_CONFIGS_QUERY,
  meetings: GET_MEETINGS_QUERY,
  meetingsSearchV2: MEETINGS_SEARCH_V2_QUERY,
  hearings: GET_HEARINGS_QUERY,
};
