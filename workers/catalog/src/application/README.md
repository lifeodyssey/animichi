# application

Application use-case layer (Clean Architecture).

Empty by design at #837: the first vertical slice (PlanItinerary application
use case) lands in #838. Inbound adapters (`src/api/*`) call use cases here;
use cases orchestrate domain kernels without knowing about I/O.
